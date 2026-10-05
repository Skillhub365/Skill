import { createFileRoute } from "@tanstack/react-router";

/**
 * A single cloud connection — administrators only.
 * GET reads it, PATCH edits metadata (and optionally rotates the secret),
 * DELETE disconnects it and purges the vault entry.
 * The client secret is never returned by any of these handlers.
 */
export const Route = createFileRoute("/api/admin/cloud/connections/$connectionId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;
        const { getConnection, getInventory } = await import("@/lib/cloud/connections/registry.server");
        const connection = getConnection(params.connectionId);
        if (!connection) return deny("NOT_FOUND", "Cloud connection not found.");
        return ok({ connection, inventory: getInventory(params.connectionId) });
      },

      PATCH: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;
        const patch = (await request.json().catch(() => null)) as
          | import("@/lib/cloud/connections/registry.server").UpdateConnectionOptions
          | null;
        if (!patch) return deny("INVALID_REQUEST", "No changes supplied.");
        const { updateConnection } = await import("@/lib/cloud/connections/registry.server");
        const connection = await updateConnection(params.connectionId, patch);
        if (!connection) return deny("NOT_FOUND", "Cloud connection not found.");
        recordCloudAudit({
          action: "connection.update",
          outcome: "success",
          actor: guard.context.principal,
          connectionId: connection.id,
          connectionName: connection.name,
          subscriptionId: connection.subscriptionId,
          detail: patch.clientSecret ? "Credentials rotated" : "Settings updated",
        });
        return ok({ connection });
      },

      DELETE: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) {
          recordCloudAudit({
            action: "connection.disconnect",
            outcome: "denied",
            actor: { sub: "anonymous", role: "unknown" },
            connectionId: params.connectionId,
            errorCode: "FORBIDDEN_ROLE",
          });
          return guard.denied;
        }
        const { deleteConnection, getConnection } = await import("@/lib/cloud/connections/registry.server");
        const existing = getConnection(params.connectionId);
        const removed = await deleteConnection(params.connectionId);
        if (!removed) return deny("NOT_FOUND", "Cloud connection not found.");
        // Health history and refresh state die with the connection.
        const { clearHealth } = await import("@/lib/cloud/connections/health.server");
        const { forgetConnectionSchedule } = await import("@/lib/cloud/connections/scheduler.server");
        clearHealth(params.connectionId);
        forgetConnectionSchedule(params.connectionId);
        recordCloudAudit({
          action: "connection.disconnect",
          outcome: "success",
          actor: guard.context.principal,
          connectionId: params.connectionId,
          connectionName: existing?.name ?? null,
          subscriptionId: existing?.subscriptionId ?? null,
        });
        return ok({ disconnected: true });
      },
    },
  },
});
