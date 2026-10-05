import { createFileRoute } from "@tanstack/react-router";

/**
 * Production cutover readiness for administrators.
 *
 * Reports live integration status and the production checklist. Emergency mock
 * fallback is audited every time it is observed, so a degraded deployment
 * leaves a trail even if nobody is watching the console.
 */
export const Route = createFileRoute("/api/admin/readiness")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const { principal } = guard.context;
        if (principal.role !== "admin" && principal.role !== "superadmin") return deny("FORBIDDEN_ROLE");

        const { readinessReport } = await import("@/lib/infra/readiness.server");
        const report = await readinessReport();

        if (report.emergencyFallbackActive || (report.environment !== "development" && report.simulatedDesktopActive)) {
          void import("@/lib/db/security-audit.server")
            .then(({ recordSecurityEvent }) =>
              recordSecurityEvent({
                action: "PRODUCTION_FALLBACK_ACTIVE",
                outcome: "failure",
                detail: report.summary,
                errorCode: "EMERGENCY_FALLBACK",
              }),
            )
            .catch(() => null);
        }

        return Response.json(report, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
