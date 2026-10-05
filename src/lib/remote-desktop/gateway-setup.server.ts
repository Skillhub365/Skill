/**
 * Super Admin deployment of the remote-desktop gateway (Apache Guacamole).
 *
 * Two responsibilities:
 *   1. store where the gateway lives and which platform account to use, in the
 *      secret vault (Key Vault, or the AES-GCM local store), mirrored into the
 *      process environment so existing config readers pick it up immediately;
 *   2. verify reachability on both legs — app -> gateway, and gateway -> lab
 *      network — and persist that verdict durably so learner sessions can be
 *      blocked until the path is proven.
 *
 * Nothing sensitive leaves this module: no password, no token, no private lab
 * address.
 */

import { readPlatformSecret, writePlatformSecret } from "@/lib/cloud/connections/secret-vault.server";
import { readSetting, writeSetting } from "@/lib/db/platform-settings.repo.server";
import { guacamoleConfig, infraModes } from "@/lib/infra/runtime.server";
import { GATEWAY_CHECK_LABEL } from "./gateway-setup-types";
import type {
  GatewayCheckId,
  GatewayCheckStatus,
  GatewaySettingsInput,
  GatewaySetupCheck,
  GatewaySetupStatus,
  GatewayVerification,
} from "./gateway-setup-types";

const SECRET = {
  baseUrl: "guacamole-url",
  publicUrl: "guacamole-public-url",
  username: "guacamole-username",
  password: "guacamole-admin-password",
  dataSource: "guacamole-data-source",
  clipboard: "guacamole-clipboard",
} as const;

const VERIFICATION_KEY = "remote-desktop.verification";
/** A passing verification is trusted for this long before it must be re-run. */
export const VERIFICATION_VALID_DAYS = 7;

let vaultLoaded = false;

/**
 * Pull stored gateway settings into the environment. Values configured at
 * deploy time always win, so a vault entry never overrides infrastructure.
 */
export async function loadGatewaySettings(force = false): Promise<void> {
  if (vaultLoaded && !force) return;
  vaultLoaded = true;
  const pairs: Array<[string, string]> = [
    ["GUACAMOLE_URL", SECRET.baseUrl],
    ["GUACAMOLE_PUBLIC_URL", SECRET.publicUrl],
    ["GUACAMOLE_USERNAME", SECRET.username],
    ["GUACAMOLE_ADMIN_PASSWORD", SECRET.password],
    ["GUACAMOLE_DATA_SOURCE", SECRET.dataSource],
    ["LAB_CLIPBOARD", SECRET.clipboard],
  ];
  for (const [envName, secretName] of pairs) {
    if (process.env[envName]) continue;
    const value = await readPlatformSecret(secretName);
    if (value) process.env[envName] = value;
  }
}

export async function saveGatewaySettings(
  input: GatewaySettingsInput,
): Promise<{ storedIn: "azure-key-vault" | "encrypted-local" }> {
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  const publicUrl = input.publicUrl.trim().replace(/\/$/, "");
  const write = await writePlatformSecret(SECRET.baseUrl, baseUrl);
  await writePlatformSecret(SECRET.publicUrl, publicUrl);
  await writePlatformSecret(SECRET.username, input.username.trim());
  if (input.password) await writePlatformSecret(SECRET.password, input.password);
  await writePlatformSecret(SECRET.dataSource, input.dataSource?.trim() || "postgresql");
  await writePlatformSecret(SECRET.clipboard, input.clipboard ?? "readwrite");

  process.env["GUACAMOLE_URL"] = baseUrl;
  process.env["GUACAMOLE_PUBLIC_URL"] = publicUrl;
  process.env["GUACAMOLE_USERNAME"] = input.username.trim();
  if (input.password) process.env["GUACAMOLE_ADMIN_PASSWORD"] = input.password;
  process.env["GUACAMOLE_DATA_SOURCE"] = input.dataSource?.trim() || "postgresql";
  process.env["LAB_CLIPBOARD"] = input.clipboard ?? "readwrite";
  vaultLoaded = true;

  // Any settings change invalidates the previous proof of reachability.
  await writeSetting(VERIFICATION_KEY, null);
  return { storedIn: write.storedIn };
}

function check(id: GatewayCheckId, status: GatewayCheckStatus, detail: string): GatewaySetupCheck {
  return { id, label: GATEWAY_CHECK_LABEL[id], status, detail };
}

function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function readVerification(): Promise<GatewayVerification | null> {
  return await readSetting<GatewayVerification>(VERIFICATION_KEY);
}

export function verificationFresh(record: GatewayVerification | null): boolean {
  if (!record?.passed) return false;
  const age = Date.now() - new Date(record.verifiedAt).getTime();
  return Number.isFinite(age) && age < VERIFICATION_VALID_DAYS * 24 * 60 * 60_000;
}

export async function gatewaySetupStatus(): Promise<GatewaySetupStatus> {
  await loadGatewaySettings();
  const modes = infraModes();
  const cfg = guacamoleConfig();
  const live = modes.environment !== "development";
  const record = await readVerification();
  return {
    environment: modes.environment,
    liveMode: modes.remoteDesktop === "guacamole",
    configured: Boolean(cfg),
    baseUrlHost: host(cfg?.baseUrl ?? null),
    publicUrl: cfg?.publicBaseUrl ?? null,
    username: cfg?.username ?? null,
    dataSource: cfg?.dataSource ?? null,
    storedIn: cfg ? ((await readPlatformSecret(SECRET.baseUrl)) ? "encrypted-local" : "environment") : null,
    labCredentialsConfigured: Boolean(cfg?.rdpUsername && cfg?.rdpPassword),
    verificationRequired: live && modes.remoteDesktop === "guacamole",
    verificationValid: verificationFresh(record),
    validForDays: VERIFICATION_VALID_DAYS,
    lastVerification: record,
  };
}

export interface VerifyOptions {
  /** Pool machine used to prove the gateway can reach the lab network. */
  vmId?: string | null;
  actor?: string | null;
}

/**
 * Verify reachability end to end and persist the verdict.
 *
 * App leg  : the platform authenticates against the gateway REST API and
 *            confirms guacd advertises RDP.
 * Lab leg   : an ephemeral connection is brokered against a real pool machine's
 *            private address and torn down again — this is the only way to know
 *            the gateway subnet can actually dial 3389 inside the lab VNet.
 */
export async function verifyGatewayReachability(options: VerifyOptions = {}): Promise<GatewayVerification> {
  await loadGatewaySettings(true);
  const startedAt = Date.now();
  const modes = infraModes();
  const cfg = guacamoleConfig();
  const checks: GatewaySetupCheck[] = [];
  let probeVmName: string | null = null;

  if (!cfg) {
    checks.push(check("configuration", "fail", "No gateway address or service account is stored yet."));
    for (const id of ["public-url", "app-to-gateway", "gateway-engine", "lab-credentials", "gateway-to-lab"] as const) {
      checks.push(check(id, "skip", "Store the gateway settings first."));
    }
    return await persist(checks, null, null, startedAt, modes.environment, options.actor ?? null);
  }

  checks.push(check("configuration", "pass", "Gateway address, service account and data source are stored."));
  checks.push(
    cfg.publicBaseUrl.startsWith("https://")
      ? check("public-url", "pass", `Learners connect over HTTPS/WSS to ${host(cfg.publicBaseUrl)}.`)
      : check(
          "public-url",
          modes.environment === "development" ? "warn" : "fail",
          "The browser-facing gateway URL is not HTTPS; desktop traffic would not be encrypted end to end.",
        ),
  );

  const { GuacamoleRemoteDesktopService } = await import("./service.server");
  const { normalizeGatewayError } = await import("./gateway-errors");
  const service = new GuacamoleRemoteDesktopService(cfg);
  let appLegOk = false;
  try {
    const protocols = await service.supportedProtocols();
    appLegOk = true;
    checks.push(check("app-to-gateway", "pass", "The gateway answered and accepted the platform service account."));
    checks.push(
      protocols.includes("rdp")
        ? check("gateway-engine", "pass", "The gateway reports RDP support, so guacd is loaded and can dial lab machines.")
        : check("gateway-engine", "fail", "The gateway does not report RDP support — guacd is missing or not registered."),
    );
  } catch (error) {
    const failure = normalizeGatewayError(error);
    checks.push(
      check(
        "app-to-gateway",
        "fail",
        failure.code === "GATEWAY_AUTH_FAILED"
          ? "The gateway rejected the platform service account."
          : failure.friendly,
      ),
    );
    checks.push(check("gateway-engine", "skip", "The gateway must answer before guacd can be checked."));
  }

  checks.push(
    cfg.rdpUsername && cfg.rdpPassword
      ? check("lab-credentials", "pass", "Lab image credentials are held server-side and injected per connection.")
      : check("lab-credentials", "fail", "No lab image RDP credentials are configured for this environment."),
  );

  // Lab-network leg against a real registered machine.
  if (!appLegOk) {
    checks.push(check("gateway-to-lab", "skip", "The gateway must answer before the lab network can be probed."));
  } else {
    try {
      const { ensurePoolLoaded, listPoolVms } = await import("@/lib/vm/pool/registry.server");
      const { poolVmKind } = await import("@/lib/vm/pool/admin-ops.server");
      await ensurePoolLoaded();
      const candidates = listPoolVms().filter((vm) => vm.status !== "RETIRED" && poolVmKind(vm) !== "mock");
      const target = options.vmId
        ? (candidates.find((vm) => vm.id === options.vmId) ?? null)
        : (candidates.find((vm) => !vm.currentSessionId) ?? candidates[0] ?? null);
      if (!target) {
        checks.push(
          check(
            "gateway-to-lab",
            "fail",
            "No real lab machine is registered, so the gateway's route into the lab network cannot be proven.",
          ),
        );
      } else {
        probeVmName = target.name;
        const { resolvePrivateIp } = await import("@/lib/vm/pool/provider.server");
        const ip = await resolvePrivateIp(target);
        if (!ip) {
          checks.push(
            check("gateway-to-lab", "fail", `No private network address could be read for ${target.name}. Start the machine and retry.`),
          );
        } else {
          const probe = await service.selfTest({ privateIp: ip, label: `verify-${target.id}` });
          const ok = probe.brokered && probe.tokenIssued && probe.cleanedUp;
          checks.push(
            check(
              "gateway-to-lab",
              ok ? "pass" : "fail",
              ok
                ? `The gateway brokered and tore down a desktop against ${target.name} inside the lab network.`
                : probe.detail,
            ),
          );
        }
      }
    } catch (error) {
      checks.push(check("gateway-to-lab", "fail", normalizeGatewayError(error).friendly));
    }
  }

  return await persist(checks, host(cfg.publicBaseUrl), probeVmName, startedAt, modes.environment, options.actor ?? null);
}

async function persist(
  checks: GatewaySetupCheck[],
  gatewayHost: string | null,
  probeVmName: string | null,
  startedAt: number,
  environment: string,
  actor: string | null,
): Promise<GatewayVerification> {
  const failed = checks.filter((c) => c.status === "fail").length;
  const record: GatewayVerification = {
    passed: failed === 0,
    environment,
    gatewayHost,
    probeVmName,
    checks,
    verifiedAt: new Date().toISOString(),
    verifiedBy: actor,
    durationMs: Date.now() - startedAt,
    summary:
      failed === 0
        ? "Reachability verified from the app and from the lab network — lab sessions are allowed."
        : `${failed} check(s) failed. Lab sessions stay blocked until reachability is proven.`,
  };
  await writeSetting(VERIFICATION_KEY, record);
  return record;
}

export interface GatewayGateResult {
  allowed: boolean;
  detail?: string;
}

/**
 * Session gate. In a live deployment that serves real desktops, a lab may only
 * start once a verification has passed on both legs and is still fresh.
 */
export async function gatewayReadyForSessions(): Promise<GatewayGateResult> {
  const modes = infraModes();
  if (modes.environment === "development" || modes.remoteDesktop !== "guacamole") return { allowed: true };
  await loadGatewaySettings();
  if (!guacamoleConfig()) {
    return {
      allowed: false,
      detail: "The remote desktop gateway is not set up yet. A Super Admin must configure and verify it before labs can start.",
    };
  }
  const record = await readVerification();
  if (verificationFresh(record)) return { allowed: true };
  return {
    allowed: false,
    detail: record?.passed
      ? `Gateway reachability was last verified more than ${VERIFICATION_VALID_DAYS} days ago. A Super Admin must re-run the verification.`
      : "Gateway reachability has not been verified from the app and lab network. A Super Admin must run the verification before labs can start.",
  };
}
