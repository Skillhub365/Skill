import { createFileRoute } from "@tanstack/react-router";

/**
 * Re-verify a connection against real Azure. Admin capability required and
 * every attempt — allowed or denied — is written to the cloud audit log.
 */
export const Route = createFileRoute("/api/admin/cloud/connections/$connectionId/test")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const audit = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) {
          audit.recordCloudAudit({
            action: "connection.test",
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
        const actor = guard.context.principal;
        const startedAt = Date.now();
        try {
          const { connection, result } = await audit.auditedCloudOperation(
            {
              action: "connection.test",
              actor,
              connectionId: existing.id,
              connectionName: existing.name,
              subscriptionId: existing.subscriptionId,
              detail: null,
            },
            () => multiCloudController.testConnection(params.connectionId),
          );
          recordHealthSample({
            connectionId: existing.id,
            source: "manual-test",
            ok: result.ok,
            status: result.ok ? "OK" : result.status,
            latencyMs: Date.now() - startedAt,
            message: result.message ?? null,
          });
          if (!result.ok) {
            audit.recordCloudAudit({
              action: "connection.test",
              outcome: "failure",
              actor,
              connectionId: existing.id,
              connectionName: existing.name,
              subscriptionId: existing.subscriptionId,
              errorCode: result.status,
              detail: result.message,
            });
          }
          return ok({ connection, result });
        } catch (error) {
          const { normalizeErrorCode } = audit;
          recordHealthSample({
            connectionId: existing.id,
            source: "manual-test",
            ok: false,
            status: normalizeErrorCode(error),
            latencyMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : null,
          });
          return deny("UPSTREAM_ERROR", "Azure could not be reached for this connection.");
        }
      },
    },
  },
});
