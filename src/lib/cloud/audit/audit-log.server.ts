/**
 * Append-only audit log for cloud connection and VM operations.
 *
 * Every privileged cloud action lands here with a timestamp, the acting
 * principal, the target resource and a normalized error code. Raw Azure
 * messages are never stored verbatim as codes — they are mapped through
 * `normalizeErrorCode` so the log stays queryable and leaks nothing.
 *
 * Storage note: entries live in the server process ring buffer. Enabling a
 * database swaps this array for a table without changing any caller.
 */

import { AzureConnectionError } from "@/lib/cloud/connections/azure-arm.server";
import { CloudConnectionMissing } from "@/lib/cloud/connections/controller.server";
import type { Principal } from "@/lib/security/types";
import type { CloudAuditAction, CloudAuditEntry, CloudAuditOutcome } from "./types";

const MAX_ENTRIES = 1000;
const entries: CloudAuditEntry[] = [];

export const SYSTEM_ACTOR = {
  sub: "system",
  name: "SkillTrack scheduler",
  role: "system",
} as const;

/** Denied requests may have no valid principal, so the role stays a string. */
export type AuditActor = { sub: string; role: Principal["role"] | string; name?: string | null };

/** Map any thrown value onto a stable code the UI and reports can rely on. */
export function normalizeErrorCode(error: unknown): string {
  if (error instanceof AzureConnectionError) {
    switch (error.kind) {
      case "AUTHENTICATION_ERROR":
        return "AZURE_AUTH_FAILED";
      case "PERMISSION_ERROR":
        return "AZURE_PERMISSION_DENIED";
      case "SUBSCRIPTION_ERROR":
        return "AZURE_SUBSCRIPTION_INVALID";
      case "RESOURCE_GROUP_NOT_FOUND":
        return "AZURE_RESOURCE_NOT_FOUND";
      case "UNAVAILABLE":
        return "AZURE_UNAVAILABLE";
      default:
        return "AZURE_REQUEST_FAILED";
    }
  }
  if (error instanceof CloudConnectionMissing) return "CONNECTION_NOT_FOUND";
  if (error instanceof Error && error.name === "TimeoutError") return "AZURE_TIMEOUT";
  if (error instanceof Error && /abort/i.test(error.message)) return "AZURE_TIMEOUT";
  return "UNKNOWN_ERROR";
}

export interface AuditInput {
  action: CloudAuditAction;
  outcome: CloudAuditOutcome;
  actor: AuditActor | typeof SYSTEM_ACTOR;
  connectionId?: string | null;
  connectionName?: string | null;
  subscriptionId?: string | null;
  workspaceId?: string | null;
  resourceGroup?: string | null;
  target?: string | null;
  errorCode?: string | null;
  detail?: string | null;
  durationMs?: number;
}

export function recordCloudAudit(input: AuditInput): CloudAuditEntry {
  const entry: CloudAuditEntry = {
    id: `audit-${crypto.randomUUID().slice(0, 12)}`,
    at: new Date().toISOString(),
    action: input.action,
    outcome: input.outcome,
    actorId: input.actor.sub,
    actorName: ("name" in input.actor ? input.actor.name : null) || input.actor.sub,
    actorRole: input.actor.role,
    connectionId: input.connectionId ?? null,
    connectionName: input.connectionName ?? null,
    subscriptionId: input.subscriptionId ?? null,
    workspaceId: input.workspaceId ?? null,
    resourceGroup: input.resourceGroup ?? null,
    target: input.target ?? null,
    errorCode: input.errorCode ?? null,
    detail: input.detail ?? null,
    durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return entry;
}

/**
 * Run a cloud operation and audit both outcomes. Failures are re-thrown so the
 * caller still owns the HTTP response; only the log entry is added here.
 */
export async function auditedCloudOperation<T>(
  input: Omit<AuditInput, "outcome" | "errorCode" | "durationMs">,
  operation: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    recordCloudAudit({ ...input, outcome: "success", durationMs: Date.now() - started });
    return result;
  } catch (error) {
    recordCloudAudit({
      ...input,
      outcome: "failure",
      errorCode: normalizeErrorCode(error),
      detail: error instanceof Error ? error.message.slice(0, 300) : null,
      durationMs: Date.now() - started,
    });
    throw error;
  }
}

export interface AuditQuery {
  connectionId?: string | undefined;
  workspaceId?: string | undefined;
  action?: string | undefined;
  outcome?: string | undefined;
  limit?: number | undefined;
}

export function listCloudAudit(query: AuditQuery = {}): CloudAuditEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 200, 1), MAX_ENTRIES);
  return entries
    .filter((e) => !query.connectionId || e.connectionId === query.connectionId)
    .filter((e) => !query.workspaceId || e.workspaceId === query.workspaceId)
    .filter((e) => !query.action || e.action === query.action)
    .filter((e) => !query.outcome || e.outcome === query.outcome)
    .slice(0, limit);
}
