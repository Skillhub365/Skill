/**
 * Platform secret resolution.
 *
 * One interface, two backends:
 *  - Azure Key Vault when AZURE_KEY_VAULT_URI is set (staging and production).
 *  - The server environment otherwise (local development).
 *
 * Server-only. Values are never logged, never returned to the browser and
 * never included in an API response — the admin console sees presence only.
 */

import {
  bustVaultCache,
  getVaultSecret,
  KeyVaultError,
  probeVault,
  vaultAuthMode,
  vaultConfigured,
  type VaultProbe,
} from "./azure-vault.server";

export type SecretName =
  | "SESSION_SIGNING_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "DATABASE_URL"
  | "GUACAMOLE_ADMIN_PASSWORD"
  | "GUACAMOLE_SHARED_SECRET"
  | "AZURE_TENANT_ID"
  | "AZURE_CLIENT_ID"
  | "AZURE_CLIENT_SECRET"
  | "AZURE_SUBSCRIPTION_ID"
  | "AZURE_RESOURCE_GROUP"
  | "GUACAMOLE_URL"
  | "GUACAMOLE_USERNAME"
  | "GUACAMOLE_PUBLIC_URL"
  | "LAB_VM_USERNAME"
  | "LAB_VM_PASSWORD"
  | "ENTRA_CLIENT_ID"
  | "ENTRA_TENANT_ID"
  | "ENTRA_CLIENT_SECRET";

export interface SecretDescriptor {
  name: SecretName;
  purpose: string;
  group: "platform" | "database" | "gateway" | "azure" | "identity";
  /** Required when its feature is enabled — see env-validation for the rules. */
  required: boolean;
  /** True when the value is a credential rather than a plain configuration string. */
  sensitive: boolean;
}

export const secretCatalogue: SecretDescriptor[] = [
  { name: "SESSION_SIGNING_KEY", purpose: "Signs platform-issued state (workspace access links)", group: "platform", required: false, sensitive: true },
  { name: "SUPABASE_SERVICE_ROLE_KEY", purpose: "Server-side privileged database access", group: "platform", required: true, sensitive: true },
  { name: "DATABASE_URL", purpose: "Direct platform database connection string", group: "database", required: false, sensitive: true },
  { name: "GUACAMOLE_ADMIN_PASSWORD", purpose: "Remote desktop gateway administration", group: "gateway", required: false, sensitive: true },
  { name: "GUACAMOLE_SHARED_SECRET", purpose: "Signs gateway connection tokens", group: "gateway", required: false, sensitive: true },
  { name: "GUACAMOLE_URL", purpose: "Base URL of the Guacamole gateway", group: "gateway", required: false, sensitive: false },
  { name: "GUACAMOLE_USERNAME", purpose: "Gateway account used to broker connections", group: "gateway", required: false, sensitive: false },
  { name: "GUACAMOLE_PUBLIC_URL", purpose: "Browser-facing gateway origin (HTTPS/WSS :443)", group: "gateway", required: false, sensitive: false },
  { name: "LAB_VM_USERNAME", purpose: "RDP account injected into lab desktops", group: "gateway", required: false, sensitive: true },
  { name: "LAB_VM_PASSWORD", purpose: "RDP credential injected into lab desktops", group: "gateway", required: false, sensitive: true },
  { name: "AZURE_TENANT_ID", purpose: "Azure tenant for VM provisioning", group: "azure", required: false, sensitive: false },
  { name: "AZURE_CLIENT_ID", purpose: "Service principal, or user-assigned managed identity, used by the orchestrator", group: "azure", required: false, sensitive: false },
  { name: "AZURE_CLIENT_SECRET", purpose: "Service principal credential (not needed with managed identity)", group: "azure", required: false, sensitive: true },
  { name: "AZURE_SUBSCRIPTION_ID", purpose: "Subscription that hosts lab VNets and VMs", group: "azure", required: false, sensitive: false },
  { name: "AZURE_RESOURCE_GROUP", purpose: "Resource group that holds lab VMs and NICs", group: "azure", required: false, sensitive: false },
  { name: "ENTRA_CLIENT_ID", purpose: "Microsoft Entra ID application (SSO)", group: "identity", required: false, sensitive: false },
  { name: "ENTRA_TENANT_ID", purpose: "Microsoft Entra ID directory (SSO)", group: "identity", required: false, sensitive: false },
  { name: "ENTRA_CLIENT_SECRET", purpose: "Microsoft Entra ID application credential", group: "identity", required: false, sensitive: true },
];

export type SecretProviderKind = "environment" | "azure-key-vault";

export interface SecretProvider {
  readonly kind: SecretProviderKind;
  get(name: SecretName, opts?: { fresh?: boolean }): Promise<string | null>;
}

function fromEnvironment(name: SecretName): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

const environmentProvider: SecretProvider = {
  kind: "environment",
  async get(name) {
    return fromEnvironment(name);
  },
};

/**
 * Key Vault provider. Secret names map 1:1 onto vault secret names with
 * underscores rewritten as dashes (SESSION_SIGNING_KEY -> SESSION-SIGNING-KEY),
 * which is the only transformation Key Vault's naming rules require.
 *
 * The hosting environment may still inject some values directly (Lovable Cloud
 * injects the Supabase keys), so an environment value wins when the vault does
 * not hold the secret. A vault outage is reported, not silently swallowed.
 */
const keyVaultProvider: SecretProvider = {
  kind: "azure-key-vault",
  async get(name, opts = {}) {
    try {
      const value = await getVaultSecret(name, opts);
      if (value) return value;
    } catch (error) {
      if (error instanceof KeyVaultError) {
        // Status only — the message never contains a secret value.
        console.error(`[secrets] Key Vault read failed for ${name}: ${error.message}`);
        recordSecretFailure(name);
        void reportVaultFailure(name, error);
      } else {
        console.error(`[secrets] Key Vault read failed for ${name}`);
        recordSecretFailure(name);
      }
    }
    return fromEnvironment(name);
  },
};

/** Audit a vault outage once per secret per minute, so a loop cannot flood. */
const reportedAt = new Map<string, number>();
async function reportVaultFailure(name: SecretName, error: KeyVaultError) {
  const last = reportedAt.get(name) ?? 0;
  if (Date.now() - last < 60_000) return;
  reportedAt.set(name, Date.now());
  try {
    const { recordSecurityEvent } = await import("@/lib/db/security-audit.server");
    await recordSecurityEvent({
      action: "KEY_VAULT_UNREACHABLE",
      outcome: "failure",
      detail: `Key Vault could not resolve ${name}.`,
      errorCode: error.status ? `HTTP_${error.status}` : "KEY_VAULT_ERROR",
    });
  } catch {
    /* auditing must never break secret resolution */
  }
}

export function secrets(): SecretProvider {
  return vaultConfigured() ? keyVaultProvider : environmentProvider;
}

export function secretProviderKind(): SecretProviderKind {
  return vaultConfigured() ? "azure-key-vault" : "environment";
}

/** Invalidate cached secret values so a rotated secret is picked up at once. */
export function refreshSecrets(name?: SecretName) {
  bustVaultCache(name);
}

/**
 * The platform signing key.
 *
 * There is no development default baked into the source: a hard-coded key in a
 * repository is a production incident waiting to happen. Development derives a
 * per-process ephemeral key instead, which is fine because nothing it signs
 * needs to survive a restart locally. Staging and production must supply a real
 * key and fail loudly if they do not.
 */
let ephemeralDevKey: string | null = null;

export async function signingKey(): Promise<string> {
  const configured = await secrets().get("SESSION_SIGNING_KEY");
  if (configured) return configured;

  const { deploymentEnvironment } = await import("@/lib/infra/runtime.server");
  if (deploymentEnvironment() !== "development") {
    throw new Error("SESSION_SIGNING_KEY is not configured. Refusing to sign with a fallback key outside development.");
  }
  if (!ephemeralDevKey) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    ephemeralDevKey = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    console.warn("[secrets] SESSION_SIGNING_KEY is unset; using an ephemeral development key for this process only.");
  }
  return ephemeralDevKey;
}

/** True when a real signing key is configured (no ephemeral fallback in use). */
export async function signingKeyConfigured(): Promise<boolean> {
  return Boolean(await secrets().get("SESSION_SIGNING_KEY"));
}

export interface SecretStatus extends Omit<SecretDescriptor, "required"> {
  required: boolean;
  configured: boolean;
  /** Where the value came from. Never the value itself. */
  source: SecretProviderKind | null;
}

export interface SecretReport {
  provider: SecretProviderKind;
  vaultConfigured: boolean;
  vaultAuthMode: ReturnType<typeof vaultAuthMode>;
  vault: VaultProbe;
  items: SecretStatus[];
}

/**
 * Presence-only report for the admin console. Reads through the provider so a
 * vault-backed deployment reports what the vault actually holds; values are
 * discarded immediately and never serialised.
 */
export async function secretStatus(): Promise<SecretReport> {
  const provider = secrets();
  const vault = await probeVault();
  const items = await Promise.all(
    secretCatalogue.map(async (descriptor) => {
      const value = await provider.get(descriptor.name).catch(() => null);
      const configured = Boolean(value);
      return {
        ...descriptor,
        configured,
        source: configured ? (process.env[descriptor.name] ? "environment" : provider.kind) : null,
      } satisfies SecretStatus;
    }),
  );
  return {
    provider: provider.kind,
    vaultConfigured: vaultConfigured(),
    vaultAuthMode: vaultAuthMode(),
    vault,
    items,
  };
}


/** Count secret-store failures so the operations console can alert on them. */
function recordSecretFailure(secretName: string) {
  void import("@/lib/observability/metrics.server")
    .then(({ recordMetric, METRIC }) =>
      recordMetric(METRIC.keyVaultFailure, 1, { outcome: "failure", metadata: { secretName } }),
    )
    .catch(() => null);
}
