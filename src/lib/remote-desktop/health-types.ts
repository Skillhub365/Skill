/**
 * Client-safe remote-desktop (Guacamole/RDP) health vocabulary.
 *
 * Everything here is redacted by construction: no gateway credentials, no VM
 * addresses, no tokens — only pass/fail posture and plain-language detail.
 */

export type GatewayCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface GatewayCheck {
  label: string;
  status: GatewayCheckStatus;
  detail: string;
}

/** Outcome of the most recent Super Admin "Test RDP" run, kept for the console. */
export interface GatewayTestRecord {
  at: string;
  machine: string;
  actor: string;
  ok: boolean;
  /** False when a test connection or ephemeral account could not be removed. */
  cleanedUp: boolean;
  detail: string;
}

export interface RemoteDesktopHealthReport {
  mode: "simulated" | "guacamole";
  environment: string;
  configured: boolean;
  reachable: boolean;
  authAccepted: boolean;
  /** Null when the gateway could not be queried for its protocol support. */
  rdpProtocolAvailable: boolean | null;
  publicUrlHttps: boolean;
  gatewayHost: string | null;
  clipboard: string;
  rdpCredentialsConfigured: boolean;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  /** True when learners would be served the development desktop. */
  simulationActive: boolean;
  emergencyFallbackActive: boolean;
  /** True when a live environment cannot serve desktops at all. */
  productionBlocked: boolean;
  checks: GatewayCheck[];
  summary: string;
  checkedAt: string;
  durationMs: number;
  lastTest: GatewayTestRecord | null;
}
