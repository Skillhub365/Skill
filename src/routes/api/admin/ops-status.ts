import { createFileRoute } from "@tanstack/react-router";

/**
 * Operations status for the admin console: infrastructure health, live metric
 * rollups, alert evaluation and the last background cleanup run. Administrators
 * only — the payload names workspaces and machines but never credentials.
 */
export const Route = createFileRoute("/api/admin/ops-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const windowHours = Math.min(168, Math.max(1, Number(url.searchParams.get("windowHours") ?? 24) || 24));

        const [{ infraHealth }, { rollupMetrics }, { evaluateAlerts }, { counterSnapshot }, { lastReaperRun }] =
          await Promise.all([
            import("@/lib/infra/runtime.server"),
            import("@/lib/db/metrics.repo.server"),
            import("@/lib/observability/alerts.server"),
            import("@/lib/observability/metrics.server"),
            import("@/lib/vm/pool/reaper.server"),
          ]);

        const [health, metrics, alerts] = await Promise.all([
          infraHealth(),
          rollupMetrics(windowHours),
          evaluateAlerts(Math.min(windowHours, 24)),
        ]);

        return ok({
          generatedAt: new Date().toISOString(),
          windowHours,
          health,
          metrics,
          counters: counterSnapshot(),
          alerts: alerts.alerts,
          lastCleanupRun: lastReaperRun(),
        });
      },
    },
  },
});
