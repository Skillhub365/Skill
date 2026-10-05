/**
 * Shared Azure Key Vault client — the single place the platform talks to a
 * vault.
 *
 * Both platform secrets (`secrets.server.ts`) and per-connection cloud
 * credentials (`cloud/connections/secret-vault.server.ts`) go through this
 * module so there is exactly one authentication strategy, one cache policy and
 * one redaction policy.
 *
 * Server-only. Nothing here may be imported from browser code: it resolves
 * credentials and must never appear in a client bundle.
 *
 * Authentication, in order of preference:
 *  1. Managed identity via the App Service / Container Apps IDENTITY_ENDPOINT.
 *  2. Managed identity via IMDS (VM / VMSS hosted deployments).
 *  3. Service principal (AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET)
 *     — permitted for local and staging only unless explicitly allowed with
 *     AZURE_ALLOW_SERVICE_PRINCIPAL=true.
 */

const VAULT_API = "7.4";
const VAULT_RESOURCE = "https://vault.azure.net";
const VAULT_SCOPE = `${VAULT_RESOURCE}/.default`;
const IMDS = "http://169.254.169.254/metadata/identity/oauth2/token";

/** Failures never carry a secret value or a vault response body. */
export class KeyVaultError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KeyVaultError";
  }
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export function vaultUri(): string | null {
  return env("AZURE_KEY_VAULT_URI")?.replace(/\/$/, "") ?? null;
}

export function vaultConfigured(): boolean {
  return vaultUri() !== null;
}

export type VaultAuthMode = "managed-identity" | "imds" | "service-principal" | "none";

/** Which credential the vault client would use, without acquiring a token. */
export function vaultAuthMode(): VaultAuthMode {
  if (env("IDENTITY_ENDPOINT") && env("IDENTITY_HEADER")) return "managed-identity";
  if ((env("AZURE_USE_MANAGED_IDENTITY") ?? "").toLowerCase() === "true") return "imds";
  if (env("AZURE_TENANT_ID") && env("AZURE_CLIENT_ID") && env("AZURE_CLIENT_SECRET")) return "service-principal";
  return "none";
}

/**
 * Service-principal credentials are a convenience for local and staging work.
 * Production must run on a managed identity unless an operator explicitly
 * opts in, so a leaked client secret cannot quietly become the production path.
 */
export function servicePrincipalPermitted(environment: string): boolean {
  if ((env("AZURE_ALLOW_SERVICE_PRINCIPAL") ?? "").toLowerCase() === "true") return true;
  return environment !== "production";
}

/* ------------------------------------------------------------------ token -- */

let tokenCache: { token: string; expiresAt: number } | null = null;

async function acquireToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const mode = vaultAuthMode();
  let token: string | null = null;
  let ttlSeconds = 300;

  if (mode === "managed-identity") {
    const url = new URL(env("IDENTITY_ENDPOINT")!);
    url.searchParams.set("api-version", "2019-08-01");
    url.searchParams.set("resource", VAULT_RESOURCE);
    const clientId = env("AZURE_CLIENT_ID");
    if (clientId) url.searchParams.set("client_id", clientId); // user-assigned identity
    const res = await fetch(url.toString(), { headers: { "X-IDENTITY-HEADER": env("IDENTITY_HEADER")! } });
    if (!res.ok) throw new KeyVaultError("Managed identity rejected the Key Vault token request", res.status);
    const body = (await res.json()) as { access_token: string; expires_in?: string | number };
    token = body.access_token;
    ttlSeconds = Number(body.expires_in ?? 3600);
  } else if (mode === "imds") {
    const url = new URL(IMDS);
    url.searchParams.set("api-version", "2018-02-01");
    url.searchParams.set("resource", VAULT_RESOURCE);
    const clientId = env("AZURE_CLIENT_ID");
    if (clientId) url.searchParams.set("client_id", clientId);
    const res = await fetch(url.toString(), { headers: { Metadata: "true" } });
    if (!res.ok) throw new KeyVaultError("The instance metadata service rejected the Key Vault token request", res.status);
    const body = (await res.json()) as { access_token: string; expires_in?: string | number };
    token = body.access_token;
    ttlSeconds = Number(body.expires_in ?? 3600);
  } else if (mode === "service-principal") {
    const res = await fetch(`https://login.microsoftonline.com/${env("AZURE_TENANT_ID")}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env("AZURE_CLIENT_ID")!,
        client_secret: env("AZURE_CLIENT_SECRET")!,
        scope: VAULT_SCOPE,
      }),
    });
    // Never echo the response body: a failed client_credentials call can
    // reflect part of the request back.
    if (!res.ok) throw new KeyVaultError("Azure rejected the service principal credentials", res.status);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    token = body.access_token;
    ttlSeconds = Number(body.expires_in ?? 3600);
  }

  if (!token) throw new KeyVaultError("No Azure credential is available for Key Vault");
  tokenCache = { token, expiresAt: now + Math.max(60, ttlSeconds) * 1000 };
  return token;
}

/** Forces the next call to acquire a fresh token (used after a 401). */
export function resetVaultToken() {
  tokenCache = null;
}

/* ------------------------------------------------------------------ cache -- */

const DEFAULT_TTL_MS = 5 * 60_000;

function cacheTtlMs(): number {
  const raw = Number(env("KEY_VAULT_CACHE_TTL_MS") ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS;
}

/** name -> { value, at }. Holds plaintext in process memory only, never on disk. */
let valueCache: Map<string, { value: string | null; at: number }> | null = null;
function cache() {
  if (!valueCache) valueCache = new Map();
  return valueCache;
}

/**
 * Drop cached values so the next read observes a rotated secret. Pass a name
 * to bust one entry, or nothing to bust the whole cache.
 */
export function bustVaultCache(name?: string) {
  if (name) cache().delete(name);
  else cache().clear();
}

/* -------------------------------------------------------------- operations -- */

/** Key Vault only allows alphanumerics and dashes in secret names. */
export function vaultSecretName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 127);
}

/**
 * Read a secret. Returns null when the secret does not exist; throws
 * KeyVaultError when the vault is unreachable or refuses the request, so
 * callers can distinguish "not configured" from "cannot be verified".
 */
export async function getVaultSecret(name: string, opts: { fresh?: boolean } = {}): Promise<string | null> {
  const uri = vaultUri();
  if (!uri) throw new KeyVaultError("No Key Vault is configured (AZURE_KEY_VAULT_URI)");
  const key = vaultSecretName(name);
  const ttl = cacheTtlMs();

  if (!opts.fresh && ttl > 0) {
    const hit = cache().get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
  }

  const read = async () =>
    fetch(`${uri}/secrets/${key}?api-version=${VAULT_API}`, {
      headers: { Authorization: `Bearer ${await acquireToken()}` },
    });

  let res = await read();
  if (res.status === 401) {
    resetVaultToken();
    res = await read();
  }
  if (res.status === 404) {
    cache().set(key, { value: null, at: Date.now() });
    return null;
  }
  if (!res.ok) throw new KeyVaultError(`Key Vault refused the secret read for ${key}`, res.status);

  const value = ((await res.json()) as { value?: string }).value ?? null;
  cache().set(key, { value, at: Date.now() });
  return value;
}

/** Create or rotate a secret. The value never reaches a log or a response. */
export async function setVaultSecret(name: string, value: string): Promise<{ version: string | null; rotatedAt: string }> {
  const uri = vaultUri();
  if (!uri) throw new KeyVaultError("No Key Vault is configured (AZURE_KEY_VAULT_URI)");
  const key = vaultSecretName(name);
  const res = await fetch(`${uri}/secrets/${key}?api-version=${VAULT_API}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${await acquireToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value, attributes: { enabled: true } }),
  });
  if (!res.ok) throw new KeyVaultError(`Key Vault refused the secret write for ${key}`, res.status);
  const body = (await res.json()) as { id?: string };
  bustVaultCache(key);
  return { version: body.id?.split("/").pop() ?? null, rotatedAt: new Date().toISOString() };
}

/** Disable then delete a secret. Used when a cloud connection is removed. */
export async function deleteVaultSecret(name: string): Promise<void> {
  const uri = vaultUri();
  if (!uri) return;
  const key = vaultSecretName(name);
  const token = await acquireToken();
  // Disable first so the credential stops working even if delete is denied
  // by a purge-protection policy.
  await fetch(`${uri}/secrets/${key}?api-version=${VAULT_API}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ attributes: { enabled: false } }),
  }).catch(() => null);
  await fetch(`${uri}/secrets/${key}?api-version=${VAULT_API}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  bustVaultCache(key);
}

export interface VaultProbe {
  configured: boolean;
  reachable: boolean;
  authMode: VaultAuthMode;
  uriHost: string | null;
  detail: string;
}

/**
 * Health probe for the admin console. Lists (at most) one secret name so a
 * misconfigured vault surfaces before a lab launch needs it. Returns no
 * values.
 */
export async function probeVault(): Promise<VaultProbe> {
  const uri = vaultUri();
  const authMode = vaultAuthMode();
  if (!uri) {
    return { configured: false, reachable: false, authMode, uriHost: null, detail: "No Key Vault URI is configured." };
  }
  const uriHost = (() => {
    try {
      return new URL(uri).host;
    } catch {
      return null;
    }
  })();
  try {
    const res = await fetch(`${uri}/secrets?api-version=${VAULT_API}&maxresults=1`, {
      headers: { Authorization: `Bearer ${await acquireToken()}` },
    });
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        authMode,
        uriHost,
        detail: `Key Vault responded ${res.status}. Check the access policy or RBAC role assignment.`,
      };
    }
    return { configured: true, reachable: true, authMode, uriHost, detail: "Key Vault reachable." };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      authMode,
      uriHost,
      detail: (error as Error)?.message ?? "Key Vault could not be reached.",
    };
  }
}
