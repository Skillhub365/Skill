/**
 * Client-safe model for Super Admin gateway deployment.
 *
 * The browser posts where the gateway lives and which platform account to use;
 * the server stores those values in the secret vault and verifies them. No
 * password, token or private lab address is ever part of this model.
 */

export type GatewayCheckId =
  | "configuration"
  | "public-url"
  | "app-to-gateway"
  | "gateway-engine"
  | "lab-credentials"
  | "gateway-to-lab";

export const GATEWAY_CHECK_LABEL: Record<GatewayCheckId, string> = {
  configuration: "Gateway settings stored",
  "public-url": "Browser-facing URL uses HTTPS",
  "app-to-gateway": "App can reach the gateway",
  "gateway-engine": "Remote desktop engine (guacd) ready",
  "lab-credentials": "Lab image RDP credentials present",
  "gateway-to-lab": "Gateway can reach the lab network",
};

export type GatewayCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface GatewaySetupCheck {
  id: GatewayCheckId;
  label: string;
  status: GatewayCheckStatus;
  detail: string;
}

export interface GatewayVerification {
  passed: boolean;
  environment: string;
  gatewayHost: string | null;
  /** Pool machine used for the lab-network leg, by display name. */
  probeVmName: string | null;
  checks: GatewaySetupCheck[];
  verifiedAt: string;
  verifiedBy: string | null;
  durationMs: number;
  summary: string;
}

export interface GatewaySetupStatus {
  environment: string;
  /** True when the deployment serves real desktops (not the simulator). */
  liveMode: boolean;
  configured: boolean;
  baseUrlHost: string | null;
  publicUrl: string | null;
  username: string | null;
  dataSource: string | null;
  storedIn: "azure-key-vault" | "encrypted-local" | "environment" | null;
  labCredentialsConfigured: boolean;
  /** Sessions are blocked until a passing verification exists (live only). */
  verificationRequired: boolean;
  verificationValid: boolean;
  /** How long a passing verification stays valid. */
  validForDays: number;
  lastVerification: GatewayVerification | null;
}

export interface GatewaySettingsInput {
  baseUrl: string;
  publicUrl: string;
  username: string;
  password?: string;
  dataSource?: string;
  clipboard?: "readwrite" | "readonly" | "disabled";
}

export function validateGatewaySettings(input: GatewaySettingsInput): string | null {
  const internal = input.baseUrl?.trim();
  const publicUrl = input.publicUrl?.trim();
  if (!internal || !/^https?:\/\//i.test(internal)) return "The internal gateway URL must start with http:// or https://.";
  if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) return "The browser-facing gateway URL must start with http:// or https://.";
  if (!input.username?.trim()) return "A gateway service account username is required.";
  if (input.username.trim().toLowerCase() === "guacadmin") {
    return "Use a dedicated service account — the default guacadmin account must be disabled.";
  }
  if (input.password !== undefined && input.password.length > 0 && input.password.length < 12) {
    return "The gateway service account password must be at least 12 characters.";
  }
  return null;
}
