import { createFileRoute } from "@tanstack/react-router";

/**
 * Automatic refresh controls for one cloud connection.
 * GET   reads pause state, interval and last/next run timestamps.
 * PATCH pauses/resumes or sets a custom interval (clamped server-side).
 */
export const Route = createFileRoute("/api/admin/cloud/connections/$connectionId/schedule")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;
        const { getConnection } = await import("@/lib/cloud/connections/registry.server");
        if (!getConnection(params.connectionId)) return deny("NOT_FOUND", "Cloud connection not found.");
        const scheduler = await import("@/lib/cloud/connections/scheduler.server");
        scheduler.ensureRefreshScheduler();
        return ok({ schedule: scheduler.getConnectionSchedule(params.connectionId) });
      },

      PATCH: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) {
          recordCloudAudit({
            action: "connection.schedule",
            outcome: "denied",
            actor: { sub: "anonymous", role: "unknown" },
            connectionId: params.connectionId,
            errorCode: "FORBIDDEN_ROLE",
          });
          return guard.denied;
        }

        const { getConnection } = await import("@/lib/cloud/connections/registry.server");
        const connection = getConnection(params.connectionId);
        if (!connection) return deny("NOT_FOUND", "Cloud connection not found.");

        const body = (await request.json().catch(() => null)) as { paused?: boolean; intervalMs?: number } | null;
        if (!body || (body.paused === undefined && body.intervalMs === undefined)) {
          return deny("INVALID_REQUEST", "Supply paused and/or intervalMs.");
        }

        const scheduler = await import("@/lib/cloud/connections/scheduler.server");
        scheduler.ensureRefreshScheduler();
        const schedule = scheduler.setConnectionSchedule(params.connectionId, {
          ...(body.paused !== undefined ? { paused: body.paused } : {}),
          ...(body.intervalMs !== undefined ? { intervalMs: Number(body.intervalMs) } : {}),
        });
        recordCloudAudit({
          action: "connection.schedule",
          outcome: "success",
          actor: guard.context.principal,
          connectionId: connection.id,
          connectionName: connection.name,
          subscriptionId: connection.subscriptionId,
          detail: `${schedule.paused ? "Auto refresh paused" : "Auto refresh active"} · every ${Math.round(
            schedule.intervalMs / 1000,
          )}s`,
        });
        return ok({ schedule });
      },
    },
  },
});
