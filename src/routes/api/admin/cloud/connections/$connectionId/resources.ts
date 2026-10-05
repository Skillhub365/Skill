import { createFileRoute } from "@tanstack/react-router";

/**
 * Azure inventory for one connection.
 * GET  returns the cached snapshot (kept warm by the refresh scheduler).
 * POST forces a live refresh; both require cloud admin capability.
 */
export const Route = createFileRoute("/api/admin/cloud/connections/$connectionId/resources")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;
        const { getInventory } = await import("@/lib/cloud/connections/registry.server");
        const { ensureRefreshScheduler } = await import("@/lib/cloud/connections/scheduler.server");
        return ok({ inventory: getInventory(params.connectionId), schedule: ensureRefreshScheduler() });
      },

      POST: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const audit = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) {
          audit.recordCloudAudit({
            action: "connection.refresh",
            outcome: "denied",
            actor: { sub: "anonymous", role: "unknown" },
            connectionId: params.connectionId,
            errorCode: "FORBIDDEN_ROLE",
          });
          return guard.denied;
        }

        const { getConnection } = await import("@/lib/cloud/connections/registry.server");
        const existing = getConnection(params.connectionId);
        if (!existing) return deny("NOT_FOUND", "Cloud connection not found.");

        const { multiCloudController } = await import("@/lib/cloud/connections/controller.server");
        const { recordHealthSample } = await import("@/lib/cloud/connections/health.server");
        const startedAt = Date.now();
        try {
          const { connection, inventory } = await audit.auditedCloudOperation(
            {
              action: "connection.refresh",
              actor: guard.context.principal,
              connectionId: existing.id,
              connectionName: existing.name,
              subscriptionId: existing.subscriptionId,
            },
            () => multiCloudController.refreshResources(params.connectionId),
          );
          recordHealthSample({
            connectionId: existing.id,
            source: "manual-refresh",
            ok: true,
            status: "OK",
            latencyMs: Date.now() - startedAt,
            message: `${inventory.virtualMachines.length} VMs discovered`,
          });
          return ok({ connection, inventory });
        } catch (error) {
          recordHealthSample({
            connectionId: existing.id,
            source: "manual-refresh",
            ok: false,
            status: audit.normalizeErrorCode(error),
            latencyMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : null,
          });
          return deny("UPSTREAM_ERROR", "Azure resources could not be loaded right now.");
        }
      },
    },
  },
});
