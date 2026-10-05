import { createFileRoute } from "@tanstack/react-router";

/**
 * Remote desktop (Guacamole/RDP) posture for the admin console. Redacted by
 * construction: configuration presence, reachability and check outcomes only.
 */
export const Route = createFileRoute("/api/admin/cloud/gateway-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const { principal } = guard.context;
        if (principal.role !== "admin" && principal.role !== "superadmin") return deny("FORBIDDEN_ROLE");
        const { remoteDesktopHealth } = await import("@/lib/remote-desktop/health.server");
        return ok({ health: await remoteDesktopHealth() });
      },
    },
  },
});
