import { createFileRoute } from "@tanstack/react-router";

/** Cloud audit trail — readable by roles holding "audit:read". */
export const Route = createFileRoute("/api/admin/cloud/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "audit:read");
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const { listCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const { ensureRefreshScheduler } = await import("@/lib/cloud/connections/scheduler.server");
        return ok({
          entries: listCloudAudit({
            connectionId: url.searchParams.get("connectionId") ?? undefined,
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            action: url.searchParams.get("action") ?? undefined,
            outcome: url.searchParams.get("outcome") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 200) || 200,
          }),
          schedule: ensureRefreshScheduler(),
        });
      },
    },
  },
});
