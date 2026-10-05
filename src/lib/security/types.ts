/** Client-safe security contracts shared by the browser and the server. */

import type { Role } from "@/lib/mock-data";

/** Short-lived access tokens keep a stolen token useful for minutes, not days. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** The browser refreshes well before expiry so a working learner is never kicked. */
export const ACCESS_TOKEN_REFRESH_MARGIN_SECONDS = 3 * 60;

export interface Principal {
  /** Stable user id (sub claim). */
  sub: string;
  name: string;
  email: string;
  role: Role;
  /** Tenant / organisation the user belongs to. */
  org: string;
  /** Workspace ids the user is a member of. Admins carry "*" . */
  workspaces: string[];
  /** Lab ids assigned to the user. Admins carry "*" . */
  labs: string[];
  /** Identity provider that authenticated the principal. */
  idp: "password" | "entra";
  iat: number;
  exp: number;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    org: string;
    workspaceSlug: string;
    workspaceName: string;
  };
}

/** Stable, user-facing error codes. The UI maps these to friendly copy. */
export type SecurityErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "FORBIDDEN_ROLE"
  | "FORBIDDEN_ORG"
  | "FORBIDDEN_WORKSPACE"
  | "FORBIDDEN_LAB"
  | "FORBIDDEN_SESSION"
  | "FORBIDDEN_VM"
  | "WORKSPACE_UNAVAILABLE"
  | "LAB_UNAVAILABLE"
  | "TEMPLATE_UNAVAILABLE"
  | "PROVIDER_UNSUPPORTED"
  | "CLOUD_BINDING_MISSING"
  | "SESSION_NOT_FOUND"
  | "SESSION_EXPIRED"
  | "VM_UNAVAILABLE"
  | "TENANT_LIMIT"
  | "WORKSPACE_LIMIT"
  | "USER_LIMIT"
  | "BUDGET_EXCEEDED"
  | "ACCESS_NOT_STARTED"
  | "ACCESS_ENDED"
  | "ALLOWANCE_EXHAUSTED"
  | "VM_START_FAILED"
  | "CONNECTION_FAILED"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

export const securityErrorStatus: Record<SecurityErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_EXPIRED: 401,
  FORBIDDEN_ROLE: 403,
  FORBIDDEN_ORG: 403,
  FORBIDDEN_WORKSPACE: 403,
  FORBIDDEN_LAB: 403,
  FORBIDDEN_SESSION: 403,
  FORBIDDEN_VM: 403,
  WORKSPACE_UNAVAILABLE: 404,
  LAB_UNAVAILABLE: 404,
  TEMPLATE_UNAVAILABLE: 409,
  PROVIDER_UNSUPPORTED: 409,
  CLOUD_BINDING_MISSING: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_EXPIRED: 410,
  VM_UNAVAILABLE: 503,
  TENANT_LIMIT: 429,
  WORKSPACE_LIMIT: 429,
  USER_LIMIT: 409,
  BUDGET_EXCEEDED: 429,
  ACCESS_NOT_STARTED: 403,
  ACCESS_ENDED: 403,
  ALLOWANCE_EXHAUSTED: 403,
  VM_START_FAILED: 502,
  CONNECTION_FAILED: 502,
  RATE_LIMITED: 429,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
  UNKNOWN: 500,
};

/** Role capability matrix — mirrored server-side by the request guard. */
export const capabilities = {
  // Super Admin owns cloud connectivity and everything cost related.
  superadmin: [
    "workspace:manage",
    "user:manage",
    "lab:manage",
    "template:manage",
    "vm:manage",
    "cloud:manage",
    "cloud:read",
    "cost:manage",
    "cost:read",
    "session:manage",
    "audit:read",
  ],
  admin: [
    "workspace:manage",
    "user:manage",
    "lab:manage",
    "template:manage",
    "vm:manage",
    "session:manage",
    "audit:read",
  ],
  user: ["workspace:read", "lab:read", "lab:start", "vm:connect:own", "session:manage:own"],
} as const satisfies Record<Role, readonly string[]>;

export type Capability = (typeof capabilities)[Role][number];

export function can(role: Role | undefined, capability: Capability | string): boolean {
  if (!role) return false;
  return (capabilities[role] as readonly string[]).includes(capability);
}