/**
 * Deployment runtime resolution.
 *
 * DEVELOPMENT -> Mock Azure + simulated remote desktop
 * STAGING     -> Azure (test subscription) + Guacamole
 * PRODUCTION  -> Azure + Guacamole
 *
 * Everything here is server-only: Azure and Guacamole credentials are read
 * from the environment inside functions (never at module scope) and are never
 * serialised into any response.
 */

export type DeploymentEnvironment = "development" | "staging" | "production";
export type VmProviderMode = "mock" | "azure";
export type RemoteDesktopMode = "simulated" | "guacamole";
/**
 * How the backend proves its identity to Azure Resource Manager.
 * Production prefers a managed identity (no secret to store or rotate);
 * development and staging may fall back to a service principal.
 */
export type AzureAuthMode = "managed-identity" | "service-principal";

export interface AzureConfig {
  subscriptionId: string;
  authMode: AzureAuthMode;
  /** Service-principal fields; null when running on a managed identity. */
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  resourceGroup: string;
  /** Optional default network wiring for template -> Azure mapping. */
  vnetName: string | null;
  subnetName: string | null;
  /** How long a machine may take to reach READY before we give up. */
  readinessTimeoutMs: number;
}

export interface GuacamoleConfig {
  baseUrl: string;
  /**
   * Browser-facing origin (HTTPS/WSS on :443), e.g. https://labs.skilltracklabs.com.
   * Defaults to baseUrl when the gateway is reachable on the same origin.
   */
  publicBaseUrl: string;
  username: string;
  password: string;
  /** Guacamole auth data source, usually "postgresql" or "mysql". */
  dataSource: string;
  /** Credentials injected into the dynamic RDP connection. */
  rdpUsername: string | null;
  rdpPassword: string | null;
  /** Optional AD domain for the lab image. */
  rdpDomain: string | null;
  /** RDP security negotiation used against the Windows lab image. */
  rdpSecurity: "nla" | "tls" | "rdp" | "any";
  /** Lab images use self-signed RDP certificates by default. */
  ignoreCert: boolean;
  /** Clipboard policy applied to every brokered desktop. */
  clipboard: "readwrite" | "readonly" | "disabled";
  /** Per-request budget for Guacamole REST calls. */
  requestTimeoutMs: number;
  /** How long a desktop may stay in CONNECTING before it is failed. */
  connectTimeoutMs: number;
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export function deploymentEnvironment(): DeploymentEnvironment {
  const raw = (env("SKILLTRACK_ENV") ?? env("NODE_ENV") ?? "development").toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "staging" || raw === "stage" || raw === "test") return "staging";
  return "development";
}

/**
 * True when the process runs with an Azure managed identity: App Service /
 * Container Apps inject IDENTITY_ENDPOINT, VMs and VMSS expose IMDS and are
 * opted in explicitly with AZURE_USE_MANAGED_IDENTITY=true.
 */
export function managedIdentityAvailable(): boolean {
  if ((env("AZURE_USE_MANAGED_IDENTITY") ?? "").toLowerCase() === "true") return true;
  return Boolean(env("IDENTITY_ENDPOINT") && env("IDENTITY_HEADER"));
}

/** Full Azure configuration (managed identity or service principal), or null. */
export function azureConfig(): AzureConfig | null {
  const subscriptionId = env("AZURE_SUBSCRIPTION_ID");
  const tenantId = env("AZURE_TENANT_ID");
  const clientId = env("AZURE_CLIENT_ID");
  const clientSecret = env("AZURE_CLIENT_SECRET");
  const resourceGroup = env("AZURE_RESOURCE_GROUP");
  if (!subscriptionId || !resourceGroup) return null;
  const managedIdentity = managedIdentityAvailable();
  const servicePrincipal = Boolean(tenantId && clientId && clientSecret);
  if (!managedIdentity && !servicePrincipal) return null;
  const timeout = Number(env("LAB_VM_READY_TIMEOUT_MS") ?? "");
  return {
    subscriptionId,
    authMode: managedIdentity ? "managed-identity" : "service-principal",
    tenantId,
    // A user-assigned identity is selected with its client ID.
    clientId,
    clientSecret: managedIdentity ? null : clientSecret,
    resourceGroup,
    vnetName: env("AZURE_VNET_NAME"),
    subnetName: env("AZURE_SUBNET_NAME"),
    readinessTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10 * 60_000,
  };
}

export function guacamoleConfig(): GuacamoleConfig | null {
  const baseUrl = env("GUACAMOLE_URL");
  const username = env("GUACAMOLE_USERNAME");
  const password = env("GUACAMOLE_ADMIN_PASSWORD") ?? env("GUACAMOLE_PASSWORD");
  if (!baseUrl || !username || !password) return null;
  const security = (env("LAB_RDP_SECURITY") ?? "nla").toLowerCase();
  const clipboard = (env("LAB_CLIPBOARD") ?? "readwrite").toLowerCase();
  const requestTimeout = Number(env("GUACAMOLE_REQUEST_TIMEOUT_MS") ?? "");
  const connectTimeout = Number(env("GUACAMOLE_CONNECT_TIMEOUT_MS") ?? "");
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    publicBaseUrl: (env("GUACAMOLE_PUBLIC_URL") ?? baseUrl).replace(/\/$/, ""),
    username,
    password,
    dataSource: env("GUACAMOLE_DATA_SOURCE") ?? "postgresql",
    rdpUsername: env("LAB_VM_USERNAME"),
    rdpPassword: env("LAB_VM_PASSWORD"),
    rdpDomain: env("LAB_VM_DOMAIN"),
    rdpSecurity: security === "tls" || security === "rdp" || security === "any" ? security : "nla",
    ignoreCert: (env("LAB_RDP_IGNORE_CERT") ?? "true").toLowerCase() !== "false",
    clipboard: clipboard === "disabled" || clipboard === "readonly" ? clipboard : "readwrite",
    requestTimeoutMs: Number.isFinite(requestTimeout) && requestTimeout > 0 ? requestTimeout : 15_000,
    connectTimeoutMs: Number.isFinite(connectTimeout) && connectTimeout > 0 ? connectTimeout : 60_000,
  };
}

/**
 * Emergency escape hatch. Staging and production never downgrade to simulated
 * infrastructure on their own — an operator has to opt in explicitly, and the
 * downgrade is reported in the health output so it cannot go unnoticed.
 */
function mockFallbackAllowed(): boolean {
  return (env("ALLOW_MOCK_FALLBACK") ?? "").toLowerCase() === "true";
}

export interface InfraModes {
  environment: DeploymentEnvironment;
  vm: VmProviderMode;
  remoteDesktop: RemoteDesktopMode;
  azureConfigured: boolean;
  azureAuthMode: AzureAuthMode | null;
  readinessTimeoutMs: number;
  guacamoleConfigured: boolean;
  /** True when a live environment is running on simulated infrastructure. */
  degraded: boolean;
  /** Operator-facing explanations for any degraded mode. */
  degradedReasons: string[];
  /** True when the emergency mock fallback flag is on outside development. */
  emergencyFallbackActive: boolean;
}

/**
 * Which implementations this process should use.
 *
 * Development always uses the mock Azure provider and the simulated desktop.
 * Staging and production use the real integrations and refuse to quietly
 * downgrade: an incomplete configuration is reported as `degraded` and the
 * orchestrator raises a clear error instead of handing a learner a fake VM.
 */
export function infraModes(): InfraModes {
  const environment = deploymentEnvironment();
  const azure = azureConfig();
  const azureConfigured = azure !== null;
  const guacamoleConfigured = guacamoleConfig() !== null;
  const live = environment !== "development";
  const emergency = live && mockFallbackAllowed();
  const reasons: string[] = [];

  if (live && !azureConfigured) reasons.push("Azure is not fully configured in a live environment.");
  if (live && !guacamoleConfigured) reasons.push("The remote desktop gateway is not configured in a live environment.");
  if (emergency) reasons.push("ALLOW_MOCK_FALLBACK is enabled; simulated infrastructure may serve real users.");

  return {
    environment,
    vm: live ? (azureConfigured && !emergency ? "azure" : emergency ? "mock" : "azure") : "mock",
    remoteDesktop: live
      ? guacamoleConfigured && !emergency
        ? "guacamole"
        : emergency
          ? "simulated"
          : "guacamole"
      : "simulated",
    azureConfigured,
    azureAuthMode: azure?.authMode ?? null,
    readinessTimeoutMs: azure?.readinessTimeoutMs ?? 10 * 60_000,
    guacamoleConfigured,
    degraded: reasons.length > 0,
    degradedReasons: reasons,
    emergencyFallbackActive: emergency,
  };
}

/**
 * Called before a real lab launch. In a live environment with incomplete
 * configuration this throws rather than silently serving mock infrastructure.
 */
export function assertLiveInfrastructure(feature: "vm" | "remote-desktop"): void {
  const modes = infraModes();
  if (modes.environment === "development" || modes.emergencyFallbackActive) return;
  const missing =
    feature === "vm"
      ? !modes.azureConfigured && "Azure is not configured for this environment."
      : !modes.guacamoleConfigured && "The remote desktop gateway is not configured for this environment.";
  if (missing) {
    void import("@/lib/db/security-audit.server")
      .then(({ recordSecurityEvent }) =>
        recordSecurityEvent({
          action: "PRODUCTION_FALLBACK_PREVENTED",
          outcome: "failure",
          detail: missing,
          errorCode: "INFRA_NOT_CONFIGURED",
        }),
      )
      .catch(() => null);
    throw new Error(missing);
  }
}

export interface InfraHealth extends InfraModes {
  supabaseConfigured: boolean;
  keyVaultConfigured: boolean;
  keyVaultReachable: boolean;
  keyVaultAuthMode: string;
  rdpCredentialConfigured: boolean;
  reaperConfigured: boolean;
  signingKeyConfigured: boolean;
  environmentValid: boolean;
}

/** Redacted health snapshot for the admin console. Contains no secret values. */
export async function infraHealth(): Promise<InfraHealth> {
  const modes = infraModes();
  const { probeVault, vaultAuthMode, vaultConfigured } = await import("@/lib/security/azure-vault.server");
  const { signingKeyConfigured } = await import("@/lib/security/secrets.server");
  const { validateEnvironment } = await import("./env-validation.server");
  const probe = await probeVault();
  const guac = guacamoleConfig();
  const report = await validateEnvironment();
  return {
    ...modes,
    supabaseConfigured: Boolean(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY")),
    keyVaultConfigured: vaultConfigured(),
    keyVaultReachable: probe.reachable,
    keyVaultAuthMode: vaultAuthMode(),
    rdpCredentialConfigured: Boolean(guac?.rdpUsername && guac?.rdpPassword),
    reaperConfigured: (env("DISABLE_SESSION_REAPER") ?? "").toLowerCase() !== "true",
    signingKeyConfigured: await signingKeyConfigured().catch(() => false),
    environmentValid: report.valid,
  };
}