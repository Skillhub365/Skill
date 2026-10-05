import { createFileRoute } from "@tanstack/react-router";

/**
 * Super Admin infrastructure provisioning.
 *
 * GET  — read the current Azure footprint for a connection (resource group,
 *        network, RBAC, lab administrator).
 * POST — create the missing pieces. Idempotent; safe to re-run.
 *
 * The browser never talks to Azure: it posts a desired shape and receives a
 * per-step trace. Credentials travel one way only.
 */
export const Route = createFileRoute("/api/admin/cloud/provision")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const connectionId = url.searchParams.get("connectionId");
        if (!connectionId) return deny("INVALID_REQUEST", "A cloud connection is required.");

        const { inspectInfrastructure, ProvisioningError } = await import(
          "@/lib/cloud/provisioning/azure-provision.server"
        );
        try {
          const state = await inspectInfrastructure(connectionId, {
            resourceGroup: url.searchParams.get("resourceGroup"),
            vnetName: url.searchParams.get("vnetName"),
            subnetName: url.searchParams.get("subnetName"),
          });
          return ok({ state });
        } catch (error) {
          if (error instanceof ProvisioningError) return deny("INVALID_REQUEST", error.message);
          console.error("[provision] inspect failed:", (error as Error)?.name);
          return deny("UPSTREAM_ERROR", "Azure could not be reached for this connection.");
        }
      },

      POST: async ({ request }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;
        const { principal } = guard.context;

        const body = (await request.json().catch(() => null)) as
          | (import("@/lib/cloud/provisioning/types").ProvisionRequest | null)
          | null;
        if (!body?.connectionId || !body.resourceGroup || !body.region || !body.vnetName || !body.subnetName) {
          return deny("INVALID_REQUEST", "Connection, resource group, region, virtual network and subnet are required.");
        }

        const { validateCidr, validateLabPassword, validateLabUsername, validateName } = await import(
          "@/lib/cloud/provisioning/types"
        );
        const problems = [
          validateName("Resource group", body.resourceGroup.trim()),
          validateName("Virtual network", body.vnetName.trim()),
          validateName("Subnet", body.subnetName.trim()),
          body.addressSpace ? validateCidr(body.addressSpace.trim()) : null,
          body.subnetPrefix ? validateCidr(body.subnetPrefix.trim()) : null,
          body.labUsername ? validateLabUsername(body.labUsername.trim()) : null,
          body.labPassword ? validateLabPassword(body.labPassword) : null,
        ].filter(Boolean);
        if (problems.length) return deny("INVALID_REQUEST", problems[0] as string);
        if (Boolean(body.labUsername) !== Boolean(body.labPassword)) {
          return deny("INVALID_REQUEST", "Provide both a lab administrator username and password.");
        }

        const { provisionInfrastructure, ProvisioningError } = await import(
          "@/lib/cloud/provisioning/azure-provision.server"
        );
        const { getConnection } = await import("@/lib/cloud/connections/registry.server");
        const { recordCloudAudit, normalizeErrorCode } = await import("@/lib/cloud/audit/audit-log.server");
        const connection = getConnection(body.connectionId);
        const actor = { sub: principal.sub, role: principal.role, name: principal.name };
        const started = Date.now();

        try {
          const result = await provisionInfrastructure(body);
          recordCloudAudit({
            action: "infra.provision",
            outcome: result.ok ? "success" : "failure",
            actor,
            connectionId: body.connectionId,
            connectionName: connection?.name ?? null,
            subscriptionId: connection?.subscriptionId ?? null,
            resourceGroup: body.resourceGroup,
            target: `${body.vnetName}/${body.subnetName}`,
            // The log records what changed, never a credential.
            detail: result.steps.map((s) => `${s.id}:${s.state}`).join(" "),
            durationMs: Date.now() - started,
          });
          if (body.labUsername && body.labPassword) {
            recordCloudAudit({
              action: "infra.credentials",
              outcome: result.steps.find((s) => s.id === "lab-credentials")?.state === "failed" ? "failure" : "success",
              actor,
              connectionId: body.connectionId,
              connectionName: connection?.name ?? null,
              target: body.labUsername.trim(),
              detail: "Lab VM administrator credentials stored in the secret vault",
              durationMs: 0,
            });
          }
          return ok(result);
        } catch (error) {
          recordCloudAudit({
            action: "infra.provision",
            outcome: "failure",
            actor,
            connectionId: body.connectionId,
            connectionName: connection?.name ?? null,
            resourceGroup: body.resourceGroup,
            errorCode: normalizeErrorCode(error),
            durationMs: Date.now() - started,
          });
          if (error instanceof ProvisioningError) return deny("INVALID_REQUEST", error.message);
          console.error("[provision] apply failed:", (error as Error)?.name);
          return deny("UPSTREAM_ERROR", "Azure rejected the provisioning request.");
        }
      },
    },
  },
});
