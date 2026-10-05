import { createFileRoute } from "@tanstack/react-router";

/**
 * Super Admin remote-desktop gateway deployment.
 *
 * GET  — current stored settings (redacted) and the last reachability verdict.
 * POST — { action: "save" } stores the gateway settings in the secret vault;
 *        { action: "verify" } probes the app -> gateway and gateway -> lab
 *        network legs and records the verdict that gates lab sessions.
 */
export const Route = createFileRoute("/api/admin/cloud/gateway-setup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;
        const { gatewaySetupStatus } = await import("@/lib/remote-desktop/gateway-setup.server");
        return ok({ status: await gatewaySetupStatus() });
      },

      POST: async ({ request }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;
        const { principal } = guard.context;

        const body = (await request.json().catch(() => null)) as
          | ({ action?: string; vmId?: string } & import("@/lib/remote-desktop/gateway-setup-types").GatewaySettingsInput)
          | null;
        if (!body?.action) return deny("INVALID_REQUEST", "An action is required.");

        const setup = await import("@/lib/remote-desktop/gateway-setup.server");
        const { recordCloudAudit, normalizeErrorCode } = await import("@/lib/cloud/audit/audit-log.server");
        const actor = { sub: principal.sub, role: principal.role, name: principal.name };
        const started = Date.now();

        if (body.action === "save") {
          const { validateGatewaySettings } = await import("@/lib/remote-desktop/gateway-setup-types");
          const problem = validateGatewaySettings(body);
          if (problem) return deny("INVALID_REQUEST", problem);
          try {
            const result = await setup.saveGatewaySettings(body);
            recordCloudAudit({
              action: "gateway.configure",
              outcome: "success",
              actor,
              target: new URL(body.publicUrl).host,
              detail: `Gateway settings stored in ${result.storedIn}; previous reachability proof invalidated`,
              durationMs: Date.now() - started,
            });
            return ok({ status: await setup.gatewaySetupStatus() });
          } catch (error) {
            recordCloudAudit({
              action: "gateway.configure",
              outcome: "failure",
              actor,
              errorCode: normalizeErrorCode(error),
              durationMs: Date.now() - started,
            });
            return deny("UPSTREAM_ERROR", (error as Error)?.message ?? "The gateway settings could not be stored.");
          }
        }

        if (body.action === "verify") {
          const verification = await setup.verifyGatewayReachability({
            vmId: body.vmId ?? null,
            actor: principal.name ?? principal.sub,
          });
          recordCloudAudit({
            action: "gateway.verify",
            outcome: verification.passed ? "success" : "failure",
            actor,
            target: verification.gatewayHost ?? null,
            detail: verification.checks.map((c) => `${c.id}:${c.status}`).join(" "),
            durationMs: verification.durationMs,
          });
          return ok({ verification, status: await setup.gatewaySetupStatus() });
        }

        return deny("INVALID_REQUEST", "Unknown action.");
      },
    },
  },
});
