import { createFileRoute } from "@tanstack/react-router";

/**
 * Connection health diagnostics: test/refresh outcomes over time plus the
 * recurring failure codes derived from them. Read-only, cloud admins only.
 */
export const Route = createFileRoute("/api/admin/cloud/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const only = url.searchParams.get("connectionId");
        const { listConnections } = await import("@/lib/cloud/connections/registry.server");
        const { connectionHealth } = await import("@/lib/cloud/connections/health.server");
        const scheduler = await import("@/lib/cloud/connections/scheduler.server");
        scheduler.ensureRefreshScheduler();

        const connections = listConnections().filter((c) => !only || c.id === only);
        return ok({
          health: connections.map((c) => connectionHealth(c.id, c.name)),
          schedules: scheduler.listConnectionSchedules(),
        });
      },
    },
  },
});
