/**
 * Remote desktop (Guacamole/RDP) health probe for the admin consoles.
 *
 * Answers one operational question: can this deployment actually put a learner
 * on a real desktop right now, and if not, exactly which link in the chain is
 * broken. Nothing sensitive leaves this module — no gateway password, no RDP
 * credentials, no VM addresses, no tokens.
 */

import { guacamoleConfig, infraModes } from "@/lib/infra/runtime.server";
import { GuacamoleRemoteDesktopService } from "./service.server";
import { normalizeGatewayError } from "./gateway-errors";
import type { GatewayCheck, GatewayTestRecord, RemoteDesktopHealthReport } from "./health-types";

const KEY = "__skilltrack_gateway_test__";

/** Last Super Admin RDP test, kept in worker memory for the health banner. */
export function recordGatewayTest(record: GatewayTestRecord): void {
  (globalThis as unknown as Record<string, GatewayTestRecord | undefined>)[KEY] = record;
}

export function lastGatewayTest(): GatewayTestRecord | null {
  return (globalThis as unknown as Record<string, GatewayTestRecord | undefined>)[KEY] ?? null;
}

function check(label: string, status: GatewayCheck["status"], detail: string): GatewayCheck {
  return { label, status, detail };
}

export async function remoteDesktopHealth(): Promise<RemoteDesktopHealthReport> {
  const startedAt = Date.now();
  const modes = infraModes();
  const cfg = guacamoleConfig();
  const live = modes.environment !== "development";
  const checks: GatewayCheck[] = [];

  let reachable = false;
  let authAccepted = false;
  let rdpProtocolAvailable: boolean | null = null;
  let gatewayHost: string | null = null;
  let publicUrlHttps = false;

  if (!cfg) {
    checks.push(
      check(
        "Gateway configured",
        live ? "fail" : "skip",
        live
          ? "No gateway address or platform account is configured, so no learner can reach a desktop."
          : "Development environment: the simulated desktop is served instead of a real gateway.",
      ),
    );
    checks.push(check("Gateway reachable", "skip", "Configure the gateway first."));
    checks.push(check("Remote desktop engine (guacd)", "skip", "Configure the gateway first."));
    checks.push(check("Browser-facing URL uses HTTPS", "skip", "Configure the gateway first."));
    checks.push(check("Lab image RDP credentials", "skip", "Configure the gateway first."));
  } else {
    gatewayHost = safeHost(cfg.publicBaseUrl);
    publicUrlHttps = cfg.publicBaseUrl.startsWith("https://");
    checks.push(check("Gateway configured", "pass", "Gateway address, platform account and data source are set."));

    const service = new GuacamoleRemoteDesktopService(cfg);
    try {
      const protocols = await service.supportedProtocols();
      reachable = true;
      authAccepted = true;
      rdpProtocolAvailable = protocols.includes("rdp");
      checks.push(check("Gateway reachable", "pass", "The gateway answered and accepted the platform account."));
      checks.push(
        rdpProtocolAvailable
          ? check(
              "Remote desktop engine (guacd)",
              "pass",
              "The gateway reports RDP support, so guacd is loaded and can dial lab machines.",
            )
          : check(
              "Remote desktop engine (guacd)",
              "fail",
              "The gateway does not report RDP support — guacd is missing or not registered.",
            ),
      );
    } catch (error) {
      const failure = normalizeGatewayError(error);
      checks.push(
        check(
          "Gateway reachable",
          "fail",
          failure.code === "GATEWAY_AUTH_FAILED"
            ? "The gateway rejected the platform service account."
            : failure.friendly,
        ),
      );
      checks.push(check("Remote desktop engine (guacd)", "skip", "The gateway must answer before guacd can be checked."));
    }

    checks.push(
      publicUrlHttps
        ? check("Browser-facing URL uses HTTPS", "pass", `Learners connect over HTTPS/WSS to ${gatewayHost}.`)
        : check(
            "Browser-facing URL uses HTTPS",
            live ? "fail" : "warn",
            "The browser-facing gateway URL is not HTTPS; desktop traffic would not be encrypted end to end.",
          ),
    );
    checks.push(
      cfg.rdpUsername && cfg.rdpPassword
        ? check("Lab image RDP credentials", "pass", "Credentials are held server-side and injected per connection.")
        : check("Lab image RDP credentials", "fail", "No lab image RDP credentials are configured for this environment."),
    );
  }

  if (modes.emergencyFallbackActive) {
    checks.push(
      check(
        "No silent simulation",
        "fail",
        "ALLOW_MOCK_FALLBACK is enabled: real users may be served the development desktop.",
      ),
    );
  } else if (live) {
    checks.push(
      check(
        "No silent simulation",
        cfg ? "pass" : "fail",
        cfg
          ? "This environment serves only real gateway desktops; connections fail visibly if the gateway is down."
          : "Desktop launches fail visibly because the gateway is missing — no simulated fallback is served.",
      ),
    );
  } else {
    checks.push(check("No silent simulation", "skip", "Development environment: the simulated desktop is expected."));
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const simulationActive = modes.remoteDesktop === "simulated";
  const productionBlocked = live && (!cfg || failed > 0);

  return {
    mode: modes.remoteDesktop,
    environment: modes.environment,
    configured: Boolean(cfg),
    reachable,
    authAccepted,
    rdpProtocolAvailable,
    publicUrlHttps,
    gatewayHost,
    clipboard: cfg?.clipboard ?? "readwrite",
    rdpCredentialsConfigured: Boolean(cfg?.rdpUsername && cfg?.rdpPassword),
    requestTimeoutMs: cfg?.requestTimeoutMs ?? 0,
    connectTimeoutMs: cfg?.connectTimeoutMs ?? 0,
    simulationActive,
    emergencyFallbackActive: modes.emergencyFallbackActive,
    productionBlocked,
    checks,
    summary: !cfg && !live
      ? "Development environment — learners see the simulated desktop."
      : failed === 0
        ? "The remote desktop path is healthy: learners can be connected to real machines."
        : `${failed} problem(s) block browser desktops for this environment.`,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    lastTest: lastGatewayTest(),
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
