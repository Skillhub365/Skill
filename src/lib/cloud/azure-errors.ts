/**
 * Azure failure normalisation.
 *
 * Raw Azure Resource Manager responses never reach the browser. Provider code
 * throws an AzureError with one of these codes and this module maps it to the
 * platform's own error vocabulary and calm, human copy.
 */
import type { SecurityErrorCode } from "@/lib/security/types";

export type AzureErrorCode =
  | "AZURE_NOT_CONFIGURED"
  | "AZURE_AUTH_FAILED"
  | "AZURE_VM_NOT_FOUND"
  | "AZURE_RESOURCE_GROUP_NOT_FOUND"
  | "AZURE_NETWORK_NOT_CONFIGURED"
  | "AZURE_START_FAILED"
  | "AZURE_STOP_FAILED"
  | "AZURE_QUOTA_EXCEEDED"
  | "AZURE_TIMEOUT"
  | "AZURE_UNREACHABLE"
  | "AZURE_REQUEST_FAILED";

export class AzureError extends Error {
  readonly code: AzureErrorCode;
  /** Server-side only; logged, never returned to a browser. */
  readonly detail: string | undefined;
  constructor(code: AzureErrorCode, detail?: string) {
    super(code);
    this.name = "AzureError";
    this.code = code;
    this.detail = detail;
  }
}

export function isAzureError(error: unknown): error is AzureError {
  return error instanceof AzureError;
}

const toSecurity: Record<AzureErrorCode, SecurityErrorCode> = {
  AZURE_NOT_CONFIGURED: "VM_UNAVAILABLE",
  AZURE_AUTH_FAILED: "VM_START_FAILED",
  AZURE_VM_NOT_FOUND: "VM_UNAVAILABLE",
  AZURE_RESOURCE_GROUP_NOT_FOUND: "VM_UNAVAILABLE",
  AZURE_NETWORK_NOT_CONFIGURED: "VM_UNAVAILABLE",
  AZURE_START_FAILED: "VM_START_FAILED",
  AZURE_STOP_FAILED: "VM_START_FAILED",
  AZURE_QUOTA_EXCEEDED: "VM_UNAVAILABLE",
  AZURE_TIMEOUT: "VM_START_FAILED",
  AZURE_UNREACHABLE: "CONNECTION_FAILED",
  AZURE_REQUEST_FAILED: "VM_START_FAILED",
};

/** Learner-facing sentence for each failure; no Azure wording leaks through. */
const message: Record<AzureErrorCode, string> = {
  AZURE_NOT_CONFIGURED: "Lab infrastructure is not configured for this environment yet.",
  AZURE_AUTH_FAILED: "We could not reach the lab infrastructure. Your administrator has been notified.",
  AZURE_VM_NOT_FOUND: "This lab machine no longer exists. Start the lab again to get a fresh one.",
  AZURE_RESOURCE_GROUP_NOT_FOUND: "Lab capacity is not available in this environment right now.",
  AZURE_NETWORK_NOT_CONFIGURED: "Lab networking is not configured for this environment yet.",
  AZURE_START_FAILED: "We could not bring your lab machine online. Please try again.",
  AZURE_STOP_FAILED: "The machine could not be stopped cleanly; we will keep trying in the background.",
  AZURE_QUOTA_EXCEEDED: "Lab capacity is temporarily exhausted in this region. Please try again shortly.",
  AZURE_TIMEOUT: "The machine did not become ready in time and was released. Please start the lab again.",
  AZURE_UNREACHABLE: "The machine started but is not reachable yet. Please try connecting again.",
  AZURE_REQUEST_FAILED: "The lab infrastructure did not respond as expected. Please try again.",
};

/** Map any thrown provider value onto a platform error code + safe message. */
export function normalizeAzureError(error: unknown): { code: SecurityErrorCode; azureCode: AzureErrorCode | null; message: string } {
  if (isAzureError(error)) {
    return { code: toSecurity[error.code], azureCode: error.code, message: message[error.code] };
  }
  const raw = error instanceof Error ? error.message : "";
  if (raw && raw in message) {
    const code = raw as AzureErrorCode;
    return { code: toSecurity[code], azureCode: code, message: message[code] };
  }
  return {
    code: "VM_START_FAILED",
    azureCode: null,
    message: "We could not bring your lab machine online. Nothing was charged to your session time.",
  };
}