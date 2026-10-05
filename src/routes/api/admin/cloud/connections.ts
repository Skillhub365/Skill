import { createFileRoute } from "@tanstack/react-router";

/**
 * Cloud connections collection — administrators only.
 * GET  lists every configured subscription (never the client secret).
 * POST validates the supplied credentials against real Azure, then saves.
 */
export const Route = createFileRoute("/api/admin/cloud/connections")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;
        const { listConnections, listWorkspaceLinks } = await import("@/lib/cloud/connections/registry.server");
        const { vaultKind } = await import("@/lib/cloud/connections/secret-vault.server");
        // Touching the scheduler here keeps background refresh alive from any admin visit.
        const { ensureRefreshScheduler } = await import("@/lib/cloud/connections/scheduler.server");
        return ok({
          connections: listConnections(),
          links: listWorkspaceLinks(),
          secretStore: vaultKind(),
          schedule: ensureRefreshScheduler(),
        });
      },

      POST: async ({ request }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) {
          recordCloudAudit({
            action: "connection.create",
            outcome: "denied",
            actor: { sub: "anonymous", role: "unknown" },
            errorCode: "FORBIDDEN_ROLE",
          });
          return guard.denied;
        }

        const body = (await request.json().catch(() => null)) as
          | (import("@/lib/cloud/connections/types").AzureConnectionInput & { skipValidation?: boolean })
          | null;
        if (!body?.name || !body.tenantId || !body.subscriptionId || !body.clientId || !body.clientSecret) {
          return deny("INVALID_REQUEST", "Connection name, tenant, subscription, client ID and secret are required.");
        }

        const { validateAzureCredentials } = await import("@/lib/cloud/connections/validate.server");
        const result = await validateAzureCredentials(
          {
            tenantId: body.tenantId.trim(),
            clientId: body.clientId.trim(),
            clientSecret: body.clientSecret,
            subscriptionId: body.subscriptionId.trim(),
          },
          { resourceGroup: body.defaultResourceGroup?.trim() || null },
        );
        // A connection is only ever saved as CONNECTED after real Azure calls.
        if (!result.ok) {
          recordCloudAudit({
            action: "connection.create",
            outcome: "failure",
            actor: guard.context.principal,
            connectionName: body.name,
            subscriptionId: body.subscriptionId,
            errorCode: result.status,
            detail: result.message,
          });
          return Response.json(
            { error: result.status, code: result.status, detail: result.message, result },
            { status: 422, headers: { "Cache-Control": "no-store" } },
          );
        }

        const { createConnection } = await import("@/lib/cloud/connections/registry.server");
        const connection = await createConnection({
          ...body,
          createdBy: guard.context.principal.name ?? guard.context.principal.sub,
          status: "CONNECTED",
          subscriptionName: result.subscriptionName,
          resourceGroupCount: result.resourceGroups.length,
          verified: true,
        });
        recordCloudAudit({
          action: "connection.create",
          outcome: "success",
          actor: guard.context.principal,
          connectionId: connection.id,
          connectionName: connection.name,
          subscriptionId: connection.subscriptionId,
        });
        // Warm the inventory cache and keep it fresh from now on.
        const { ensureRefreshScheduler, refreshConnectionOnSchedule } = await import(
          "@/lib/cloud/connections/scheduler.server"
        );
        ensureRefreshScheduler();
        void refreshConnectionOnSchedule(connection.id);
        return ok({ connection, result }, 201);
      },
    },
  },
});
