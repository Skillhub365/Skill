import { createFileRoute } from "@tanstack/react-router";

/**
 * Admin-only infrastructure posture. Reports modes, configuration presence and
 * environment-validation results — never a credential value.
 */
export const Route = createFileRoute("/api/infra/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const { principal } = guard.context;
        if (principal.role !== "admin" && principal.role !== "superadmin") return deny("FORBIDDEN_ROLE");

        const { infraHealth } = await import("@/lib/infra/runtime.server");
        const { validateEnvironment, featureFlags } = await import("@/lib/infra/env-validation.server");
        const health = await infraHealth();

        // Live probe of the remote desktop gateway (never returns credentials).
        const { gatewayHealth } = await import("@/lib/remote-desktop/service.server");
        const gateway = await gatewayHealth().catch(() => ({
          configured: health.guacamoleConfigured,
          reachable: false,
          detail: "Gateway health could not be determined.",
        }));

        return Response.json(
          { ...health, gateway, flags: featureFlags(), validation: await validateEnvironment() },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
