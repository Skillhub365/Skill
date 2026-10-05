import type { SecurityErrorCode } from "@/lib/security/types";

/**
 * Remote access failure taxonomy.
 *
 * Everything that can go wrong between SkillTrack and the learner's desktop —
 * Guacamole itself, guacd, RDP on the VM, the network in between — is
 * normalised here into a stable code plus copy that is safe to show a learner.
 * Provider detail (hostnames, tokens, stack traces) is logged server-side only.
 */
export type GatewayFailureCode =
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_NOT_CONFIGURED"
  | "GATEWAY_AUTH_FAILED"
  | "GUACD_UNAVAILABLE"
  | "RDP_UNAVAILABLE"
  | "VM_ENDPOINT_UNAVAILABLE"
  | "CONNECTION_TIMEOUT"
  | "NETWORK_FAILURE"
  | "UNAUTHORIZED_CONNECTION"
  | "GATEWAY_REQUEST_FAILED";

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayFailureCode,
    /** Learner-facing sentence; never contains infrastructure detail. */
    readonly friendly: string,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "GatewayError";
  }
}

const COPY: Record<GatewayFailureCode, string> = {
  GATEWAY_UNAVAILABLE: "The remote desktop service is not responding. Please try connecting again in a moment.",
  GATEWAY_NOT_CONFIGURED:
    "The remote desktop gateway is not available on this environment, so a desktop cannot be opened. Please contact your administrator.",
  GATEWAY_AUTH_FAILED: "The remote desktop service rejected the platform's credentials. An administrator has been notified.",
  GUACD_UNAVAILABLE: "The remote desktop engine is unavailable, so the desktop cannot be opened right now.",
  RDP_UNAVAILABLE: "The machine is not accepting remote desktop connections yet. Wait a few seconds and reconnect.",
  VM_ENDPOINT_UNAVAILABLE: "This machine has no private network address yet, so it cannot be reached.",
  CONNECTION_TIMEOUT: "The remote desktop connection timed out before the machine responded.",
  NETWORK_FAILURE: "The connection to the remote desktop service failed. Check your network and reconnect.",
  UNAUTHORIZED_CONNECTION: "You are not authorised to open a desktop for this machine.",
  GATEWAY_REQUEST_FAILED: "The remote desktop connection could not be created.",
};

export function gatewayFailure(code: GatewayFailureCode, detail?: string) {
  return new GatewayError(code, COPY[code], detail);
}

/** Best-effort classification of anything thrown while brokering a desktop. */
export function normalizeGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return gatewayFailure("CONNECTION_TIMEOUT", message);
  }
  if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("fetch failed")) {
    return gatewayFailure("GATEWAY_UNAVAILABLE", message);
  }
  if (lower.includes("guacd")) return gatewayFailure("GUACD_UNAVAILABLE", message);
  if (lower.includes("timed out") || lower.includes("timeout")) return gatewayFailure("CONNECTION_TIMEOUT", message);
  if (lower.includes("network")) return gatewayFailure("NETWORK_FAILURE", message);
  const known = (Object.keys(COPY) as GatewayFailureCode[]).find((code) => message === code);
  if (known) return gatewayFailure(known, message);
  return gatewayFailure("GATEWAY_REQUEST_FAILED", message);
}

/** How each failure surfaces through the platform's shared error vocabulary. */
export function securityCodeFor(code: GatewayFailureCode): SecurityErrorCode {
  switch (code) {
    case "UNAUTHORIZED_CONNECTION":
      return "FORBIDDEN_VM";
    case "VM_ENDPOINT_UNAVAILABLE":
    case "RDP_UNAVAILABLE":
      return "VM_UNAVAILABLE";
    default:
      return "CONNECTION_FAILED";
  }
}