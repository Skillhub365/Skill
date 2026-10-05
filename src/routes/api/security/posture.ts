import { createFileRoute } from "@tanstack/react-router";

/**
 * Admin-only security posture: secret presence (never values), authentication
 * mode, environment validation and the recent session audit.
 */
export const Route = createFileRoute("/api/security/posture")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const { principal } = guard.context;
        if (principal.role !== "admin" && principal.role !== "superadmin") return deny("FORBIDDEN_ROLE");

        const { secretStatus } = await import("@/lib/security/secrets.server");
        const { listAudit } = await import("@/lib/session/registry.server");
        const { validateEnvironment, featureFlags } = await import("@/lib/infra/env-validation.server");
        const { infraModes } = await import("@/lib/infra/runtime.server");

        const flags = featureFlags();
        const modes = infraModes();
        const secrets = await secretStatus();

        return Response.json(
          {
            secrets,
            validation: await validateEnvironment(),
            auth: {
              // One production auth mode: accounts live in the platform
              // identity service; Microsoft sign-in is brokered through it.
              provider: "platform-identity",
              passwordAuthEnabled: true,
              microsoftSignInEnabled: true,
              entraDirectSso: flags.entraEnabled,
              localTokenMinting: false,
            },
            fallback: {
              devFallbackActive: modes.environment === "development",
              emergencyFallbackActive: modes.emergencyFallbackActive,
              degraded: modes.degraded,
              reasons: modes.degradedReasons,
            },
            audit: (await listAudit()).slice(0, 40),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
