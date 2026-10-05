/**
 * Auth and security audit trail.
 *
 * A thin, deliberately narrow wrapper over `recordActivity` so every security
 * event uses the same vocabulary and the same redaction rules. Nothing written
 * here may contain a token, password, secret value, private IP, RDP credential
 * or OAuth code — callers pass a human-readable detail string only.
 */

import { recordActivity } from "./events.repo.server";

export type SecurityEventType =
  | "LOGIN_SUCCEEDED"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "PROFILE_RESOLVED"
  | "ACCESS_DENIED"
  | "USER_INVITED"
  | "USER_SUSPENDED"
  | "USER_REACTIVATED"
  | "ROLE_CHANGED"
  | "WORKSPACE_MEMBERSHIP_CHANGED"
  | "LAB_ASSIGNMENT_CHANGED"
  | "CAPABILITIES_CHANGED"
  | "CLOUD_SECRET_ROTATED"
  | "ENV_VALIDATION_FAILED"
  | "KEY_VAULT_UNREACHABLE"
  | "PRODUCTION_FALLBACK_PREVENTED"
  | "PRODUCTION_FALLBACK_ACTIVE";

export interface SecurityEventInput {
  action: SecurityEventType;
  tenantId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  targetType?: string;
  targetId?: string | null;
  target?: string;
  workspaceId?: string | null;
  outcome?: "success" | "failure";
  detail?: string;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}

/** Keys that must never be persisted even if a caller passes them by mistake. */
const FORBIDDEN = /token|password|secret|credential|private_?ip|authorization|code$/i;

function scrub(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !FORBIDDEN.test(key)),
  );
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  await recordActivity({
    tenantId: input.tenantId ?? null,
    action: input.action,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    actorRole: input.actorRole ?? null,
    targetType: input.targetType ?? "security",
    targetId: input.targetId ?? null,
    ...(input.target ? { target: input.target } : {}),
    workspaceId: input.workspaceId ?? null,
    outcome: input.outcome ?? "success",
    ...(input.detail ? { detail: input.detail } : {}),
    errorCode: input.errorCode ?? null,
    metadata: { category: "security", ...scrub(input.metadata) },
  });
}
