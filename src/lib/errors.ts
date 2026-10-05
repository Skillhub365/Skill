import type { SecurityErrorCode } from "@/lib/security/types";

export interface FriendlyError {
  title: string;
  message: string;
  action?: string;
}

/**
 * Single place where machine error codes become calm, human sentences. Nothing
 * here leaks provider, gateway or credential detail.
 */
const catalogue: Record<SecurityErrorCode, FriendlyError> = {
  TEMPLATE_UNAVAILABLE: {
    title: "Lab image unavailable",
    message: "The desktop image for this lab is not available. An administrator needs to review its template.",
  },
  PROVIDER_UNSUPPORTED: {
    title: "Cloud not supported",
    message: "This lab is configured for a cloud that the platform cannot launch yet.",
  },
  CLOUD_BINDING_MISSING: {
    title: "Cloud not connected",
    message: "This workspace has no cloud subscription connected, so labs cannot start.",
  },
  NOT_FOUND: {
    title: "Not found",
    message: "That item no longer exists, or it was removed by an administrator.",
  },
  BUDGET_EXCEEDED: {
    title: "Monthly lab allowance used",
    message:
      "This month's lab machine allowance has been used up. An administrator can raise the allowance, or you can try again next month.",
    action: "Contact your administrator",
  },
  ACCESS_NOT_STARTED: {
    title: "Access has not opened yet",
    message: "Your access to this lab starts later. You can come back once the start date arrives.",
  },
  ACCESS_ENDED: {
    title: "Access period has ended",
    message: "Your access window for this lab has closed. An administrator can extend it for you.",
    action: "Contact your administrator",
  },
  ALLOWANCE_EXHAUSTED: {
    title: "Lab hours used up",
    message: "You have used all of the hours allocated for this lab. An administrator can add more hours.",
    action: "Contact your administrator",
  },
  USER_LIMIT: {
    title: "A lab is already running",
    message: "You can only run one lab at a time. Stop your current lab, then start this one.",
    action: "Go to my session",
  },
  WORKSPACE_LIMIT: {
    title: "Workspace is at capacity",
    message: "This workspace has reached its limit of simultaneous lab sessions. Please try again shortly.",
    action: "Try again",
  },
  TENANT_LIMIT: {
    title: "Organisation is at capacity",
    message: "Your organisation has reached its limit of simultaneous lab sessions. Please try again shortly.",
    action: "Try again",
  },
  UPSTREAM_ERROR: {
    title: "Cloud service unavailable",
    message: "The cloud provider could not be reached. Please try again in a moment.",
    action: "Try again",
  },
  AUTH_REQUIRED: {
    title: "Sign in required",
    message: "Please sign in to continue. A link on its own never grants access to a lab environment.",
    action: "Sign in",
  },
  AUTH_INVALID: {
    title: "Sign in required",
    message: "Your credentials could not be verified. Please sign in again.",
    action: "Sign in",
  },
  AUTH_EXPIRED: {
    title: "Your sign-in expired",
    message: "For security, sign-ins are short lived. Sign in again to pick up where you left off.",
    action: "Sign in",
  },
  FORBIDDEN_ROLE: {
    title: "Not available for your role",
    message: "This area is restricted to platform administrators.",
  },
  FORBIDDEN_ORG: {
    title: "Different organisation",
    message: "This resource belongs to another organisation.",
  },
  FORBIDDEN_WORKSPACE: {
    title: "Workspace access denied",
    message: "You are not a member of this workspace. Ask your administrator to add you.",
  },
  FORBIDDEN_LAB: {
    title: "Lab not assigned to you",
    message: "This lab has not been assigned to your account.",
  },
  FORBIDDEN_SESSION: {
    title: "Session belongs to someone else",
    message: "Each learner gets an isolated session and virtual machine. You cannot open another person's session.",
  },
  FORBIDDEN_VM: {
    title: "Machine access denied",
    message: "This virtual machine is not part of your session.",
  },
  WORKSPACE_UNAVAILABLE: {
    title: "Workspace unavailable",
    message: "This workspace is disabled or no longer published. Contact your administrator.",
  },
  LAB_UNAVAILABLE: {
    title: "Lab unavailable",
    message: "This lab is not published right now. Please try again later.",
  },
  SESSION_NOT_FOUND: {
    title: "Session not found",
    message: "We could not find this session. It may have already been closed.",
    action: "Back to my labs",
  },
  SESSION_EXPIRED: {
    title: "Session expired",
    message: "Your lab time has elapsed and the machine was released. Start the lab again to get a fresh environment.",
    action: "Back to my labs",
  },
  VM_UNAVAILABLE: {
    title: "No machine available",
    message: "Lab capacity is temporarily exhausted in this region. Please try again in a few minutes.",
    action: "Try again",
  },
  VM_START_FAILED: {
    title: "The machine failed to start",
    message: "We could not bring your lab machine online. Nothing was charged to your session time.",
    action: "Try again",
  },
  CONNECTION_FAILED: {
    title: "Connection failed",
    message: "The secure desktop connection could not be established. Check your network and reconnect.",
    action: "Reconnect",
  },
  RATE_LIMITED: {
    title: "Too many attempts",
    message: "Please wait a moment before trying again.",
  },
  INVALID_REQUEST: {
    title: "Something looked wrong",
    message: "That request could not be processed. Please refresh the page and try again.",
  },
  UNKNOWN: {
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again — if it persists, contact your administrator.",
  },
};

export function isSecurityErrorCode(value: unknown): value is SecurityErrorCode {
  return typeof value === "string" && value in catalogue;
}

export function describeError(code: SecurityErrorCode | string | undefined | null): FriendlyError {
  if (isSecurityErrorCode(code)) return catalogue[code];
  return catalogue.UNKNOWN;
}

/** Turn any thrown value (including API errors carrying a code) into UI copy. */
export function friendlyFrom(error: unknown): FriendlyError {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (isSecurityErrorCode(code)) return catalogue[code];
  }
  if (error instanceof Error && error.message) {
    return { ...catalogue.UNKNOWN, message: error.message };
  }
  return catalogue.UNKNOWN;
}

/** Error shape thrown by the API clients so callers can branch on a code. */
export class ApiError extends Error {
  readonly code: SecurityErrorCode;
  readonly status: number;
  constructor(code: SecurityErrorCode, message?: string, status = 400) {
    super(message ?? describeError(code).message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}