/**
 * Startup environment validation.
 *
 * Development warns and keeps going with local fallbacks. Staging and
 * production fail fast: a missing signing key or an unreachable Key Vault is a
 * security problem, not something to discover during a lab launch.
 *
 * Server-only. The report it produces is redacted — presence and reachability,
 * never a value.
 */

import { deploymentEnvironment, azureConfig, guacamoleConfig, managedIdentityAvailable } from "./runtime.server";
import { probeVault, servicePrincipalPermitted, vaultAuthMode, vaultConfigured } from "@/lib/security/azure-vault.server";

export type Severity = "ok" | "warning" | "error";

export interface CheckResult {
  key: string;
  label: string;
  severity: Severity;
  detail: string;
}

export interface EnvValidationReport {
  environment: ReturnType<typeof deploymentEnvironment>;
  valid: boolean;
  checkedAt: string;
  errors: CheckResult[];
  warnings: CheckResult[];
  checks: CheckResult[];
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

const truthy = (name: string) => (env(name) ?? "").toLowerCase() === "true";

/** Feature switches decide which groups of configuration are mandatory. */
export function featureFlags() {
  return {
    remoteDesktopEnabled: !truthy("DISABLE_REMOTE_DESKTOP"),
    entraEnabled: truthy("ENABLE_ENTRA_SSO"),
    reaperEnabled: !truthy("DISABLE_SESSION_REAPER"),
    dynamicProvisioning: truthy("ENABLE_DYNAMIC_VM_PROVISIONING"),
    emergencyMockFallback: truthy("ALLOW_MOCK_FALLBACK"),
  };
}

async function runChecks(): Promise<CheckResult[]> {
  const environment = deploymentEnvironment();
  const live = environment !== "development";
  const flags = featureFlags();
  const checks: CheckResult[] = [];

  const add = (key: string, label: string, severity: Severity, detail: string) =>
    checks.push({ key, label, severity, detail });

  /* ------------------------------------------------------------- platform */
  add(
    "environment",
    "Deployment environment",
    "ok",
    `Running as ${environment} (SKILLTRACK_ENV${env("SKILLTRACK_ENV") ? "" : " unset, inferred"}).`,
  );

  for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
    add(
      name.toLowerCase(),
      name.replace(/_/g, " ").toLowerCase(),
      env(name) ? "ok" : "error",
      env(name) ? "Configured." : `${name} is missing. The platform cannot reach its database.`,
    );
  }

  /* ------------------------------------------------------------ key vault */
  if (vaultConfigured()) {
    const probe = await probeVault();
    add(
      "key_vault",
      "Azure Key Vault",
      probe.reachable ? "ok" : live ? "error" : "warning",
      probe.detail,
    );
    if (vaultAuthMode() === "service-principal" && !servicePrincipalPermitted(environment)) {
      add(
        "key_vault_auth",
        "Key Vault credential",
        "error",
        "Production is using a service principal for Key Vault. Move to a managed identity, or set AZURE_ALLOW_SERVICE_PRINCIPAL=true to accept the risk.",
      );
    } else {
      add("key_vault_auth", "Key Vault credential", "ok", `Authenticating with ${vaultAuthMode()}.`);
    }
  } else {
    add(
      "key_vault",
      "Azure Key Vault",
      live ? "error" : "warning",
      live
        ? "AZURE_KEY_VAULT_URI is not set. Staging and production must resolve secrets from Key Vault."
        : "No Key Vault configured; development reads secrets from the environment.",
    );
  }

  /* --------------------------------------------------------- signing key */
  const { signingKeyConfigured } = await import("@/lib/security/secrets.server");
  const signing = await signingKeyConfigured().catch(() => false);
  add(
    "session_signing_key",
    "Session signing key",
    signing ? "ok" : live ? "error" : "warning",
    signing
      ? "Configured."
      : live
        ? "SESSION_SIGNING_KEY is missing. Signing is refused outside development."
        : "Unset; an ephemeral per-process key is used locally.",
  );

  /* ---------------------------------------------------------------- azure */
  const azure = azureConfig();
  add(
    "azure",
    "Azure Resource Manager",
    azure ? "ok" : live ? "error" : "warning",
    azure
      ? `Subscription and resource group configured; authenticating with ${azure.authMode}.`
      : "AZURE_SUBSCRIPTION_ID / AZURE_RESOURCE_GROUP plus a managed identity or service principal are required to drive real VMs.",
  );
  if (azure) {
    if (azure.authMode === "service-principal" && !servicePrincipalPermitted(environment)) {
      add(
        "azure_auth",
        "Azure credential",
        "error",
        "Production is using a service principal for Azure. Move to a managed identity, or set AZURE_ALLOW_SERVICE_PRINCIPAL=true.",
      );
    } else {
      add("azure_auth", "Azure credential", "ok", `Using ${azure.authMode}.`);
    }
    add(
      "azure_network",
      "Lab network",
      azure.vnetName && azure.subnetName ? "ok" : "warning",
      azure.vnetName && azure.subnetName
        ? "Virtual network and subnet configured."
        : "AZURE_VNET_NAME / AZURE_SUBNET_NAME are unset; dynamic provisioning will need them.",
    );
    if (flags.dynamicProvisioning && !(azure.vnetName && azure.subnetName)) {
      add(
        "azure_network_required",
        "Lab network",
        "error",
        "Dynamic VM provisioning is enabled but no virtual network / subnet is configured.",
      );
    }
  }
  add(
    "azure_identity_mode",
    "Azure identity mode",
    "ok",
    managedIdentityAvailable() ? "Managed identity detected." : "No managed identity detected.",
  );

  /* ----------------------------------------------------------- guacamole */
  if (flags.remoteDesktopEnabled) {
    const guac = guacamoleConfig();
    add(
      "guacamole",
      "Remote desktop gateway",
      guac ? "ok" : live ? "error" : "warning",
      guac
        ? "Gateway URL and service account configured."
        : "GUACAMOLE_URL, GUACAMOLE_USERNAME and GUACAMOLE_ADMIN_PASSWORD are required to broker real desktops.",
    );
    const rdp = Boolean(env("LAB_VM_USERNAME") && env("LAB_VM_PASSWORD"));
    add(
      "rdp_credentials",
      "Lab RDP credential",
      rdp ? "ok" : guac && live ? "error" : "warning",
      rdp ? "Configured." : "LAB_VM_USERNAME / LAB_VM_PASSWORD are required for brokered RDP sessions.",
    );
    if (guac && live && !guac.publicBaseUrl.startsWith("https://")) {
      add(
        "guacamole_tls",
        "Gateway transport",
        "error",
        "The browser-facing gateway URL is not HTTPS. Set GUACAMOLE_PUBLIC_URL to an HTTPS origin.",
      );
    }
  } else {
    add("guacamole", "Remote desktop gateway", "warning", "Remote desktop is disabled by DISABLE_REMOTE_DESKTOP.");
  }

  /* --------------------------------------------------------------- entra */
  if (flags.entraEnabled) {
    const ok = Boolean(env("ENTRA_CLIENT_ID") && env("ENTRA_TENANT_ID"));
    add(
      "entra",
      "Microsoft Entra ID",
      ok ? "ok" : "error",
      ok
        ? "Entra application configured."
        : "ENABLE_ENTRA_SSO is on but ENTRA_CLIENT_ID / ENTRA_TENANT_ID are missing.",
    );
  } else {
    add("entra", "Microsoft Entra ID", "ok", "Microsoft sign-in is brokered through the platform identity provider.");
  }

  /* -------------------------------------------------------------- reaper */
  add(
    "reaper",
    "Session reaper",
    flags.reaperEnabled ? "ok" : live ? "error" : "warning",
    flags.reaperEnabled
      ? "Expired sessions are reclaimed automatically."
      : "DISABLE_SESSION_REAPER is set; expired sessions will keep their VMs allocated.",
  );

  /* ----------------------------------------------------- fallback policy */
  if (live && flags.emergencyMockFallback) {
    add(
      "mock_fallback",
      "Mock fallback",
      "warning",
      "ALLOW_MOCK_FALLBACK is enabled outside development. Simulated infrastructure may serve real users.",
    );
  }

  return checks;
}

let cached: { report: EnvValidationReport; at: number } | null = null;
const REPORT_TTL_MS = 30_000;

/** Full validation report. Cached briefly so health endpoints stay cheap. */
export async function validateEnvironment(opts: { fresh?: boolean } = {}): Promise<EnvValidationReport> {
  if (!opts.fresh && cached && Date.now() - cached.at < REPORT_TTL_MS) return cached.report;

  const checks = await runChecks();
  const errors = checks.filter((c) => c.severity === "error");
  const warnings = checks.filter((c) => c.severity === "warning");
  const report: EnvValidationReport = {
    environment: deploymentEnvironment(),
    valid: errors.length === 0,
    checkedAt: new Date().toISOString(),
    errors,
    warnings,
    checks,
  };
  cached = { report, at: Date.now() };
  return report;
}

let bootChecked = false;

/**
 * Runs once per process, on the first server request. Development logs
 * warnings; staging and production throw so the deployment fails visibly
 * rather than serving traffic with a missing credential.
 */
export async function ensureEnvironmentValidated(): Promise<EnvValidationReport> {
  const report = await validateEnvironment();
  if (bootChecked) return report;
  bootChecked = true;

  for (const warning of report.warnings) console.warn(`[env] ${warning.label}: ${warning.detail}`);
  for (const error of report.errors) console.error(`[env] ${error.label}: ${error.detail}`);

  if (!report.valid) {
    try {
      const { recordSecurityEvent } = await import("@/lib/db/security-audit.server");
      await recordSecurityEvent({
        action: "ENV_VALIDATION_FAILED",
        outcome: "failure",
        detail: `${report.errors.length} configuration problem(s) in ${report.environment}: ${report.errors
          .map((e) => e.label)
          .join(", ")}`,
        errorCode: "ENV_INVALID",
      });
    } catch {
      /* the audit write must not mask the configuration error */
    }
    if (report.environment !== "development") {
      throw new Error(
        `Environment validation failed in ${report.environment}: ${report.errors.map((e) => e.detail).join(" | ")}`,
      );
    }
  }
  return report;
}
