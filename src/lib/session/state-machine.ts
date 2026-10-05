/**
 * Durable launch state machine (Phase 5).
 *
 * Session and pool-VM states are the contract between the launch route, the
 * orchestrator and the reaper. Transitions are declared here, validated before
 * they are written, and every applied transition is persisted plus recorded as
 * a lifecycle/session event, so a restarted worker can resume from the last
 * durable phase instead of guessing.
 */

import type { SessionState } from "./types";

export type PoolVmState =
  | "AVAILABLE"
  | "ALLOCATED"
  | "STARTING"
  | "BOOTING"
  | "RUNNING"
  | "READY"
  | "IN_USE"
  | "STOPPING"
  | "STOPPED"
  | "ERROR"
  | "RETIRED";

/** Terminal session states — nothing may leave them. */
export const TERMINAL_SESSION_STATES: SessionState[] = ["EXPIRED", "STOPPED", "ERROR"];

const SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  REQUESTED: ["ALLOCATING", "STOPPING", "ERROR", "STOPPED"],
  ALLOCATING: ["CREATING", "STARTING", "STOPPING", "ERROR", "STOPPED"],
  CREATING: ["STARTING", "STOPPING", "ERROR", "STOPPED"],
  STARTING: ["BOOTING", "READY", "ACTIVE", "STOPPING", "ERROR", "STOPPED", "EXPIRED"],
  BOOTING: ["READY", "ACTIVE", "STOPPING", "ERROR", "STOPPED", "EXPIRED"],
  READY: ["ACTIVE", "STOPPING", "DISCONNECTING", "ERROR", "STOPPED", "EXPIRED"],
  ACTIVE: ["READY", "DISCONNECTING", "STOPPING", "ERROR", "STOPPED", "EXPIRED"],
  DISCONNECTING: ["STOPPING", "STOPPED", "EXPIRED", "ERROR"],
  STOPPING: ["STOPPED", "EXPIRED", "ERROR"],
  EXPIRED: [],
  STOPPED: [],
  ERROR: [],
};

const VM_TRANSITIONS: Record<PoolVmState, PoolVmState[]> = {
  // Super Admin may boot an idle machine directly for capacity validation.
  AVAILABLE: ["ALLOCATED", "STARTING", "BOOTING", "RUNNING", "STOPPING", "STOPPED", "ERROR", "RETIRED"],
  ALLOCATED: ["STARTING", "AVAILABLE", "STOPPING", "ERROR", "RETIRED"],
  STARTING: ["BOOTING", "RUNNING", "READY", "STOPPING", "ERROR", "AVAILABLE"],
  BOOTING: ["RUNNING", "READY", "STOPPING", "ERROR", "AVAILABLE"],
  RUNNING: ["READY", "IN_USE", "STOPPING", "STOPPED", "ERROR", "AVAILABLE", "RETIRED"],
  READY: ["IN_USE", "RUNNING", "STOPPING", "ERROR", "AVAILABLE", "RETIRED"],
  IN_USE: ["STOPPING", "READY", "RUNNING", "ERROR", "AVAILABLE"],
  STOPPING: ["STOPPED", "AVAILABLE", "ERROR", "RETIRED"],
  STOPPED: ["AVAILABLE", "STARTING", "ERROR", "RETIRED"],
  ERROR: ["AVAILABLE", "STOPPING", "STOPPED", "RETIRED"],
  // Terminal: a retired machine never re-enters allocation automatically. A
  // Super Admin returning one to service is an explicit override, not a
  // lifecycle transition (see restoreRetiredVm).
  RETIRED: [],
};

export function isTerminalSessionState(state: SessionState) {
  return TERMINAL_SESSION_STATES.includes(state);
}

export function canTransitionSession(from: SessionState, to: SessionState): boolean {
  if (from === to) return true; // idempotent re-application is always allowed
  return (SESSION_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionVm(from: PoolVmState, to: PoolVmState): boolean {
  if (from === to) return true;
  return (VM_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Invalid transitions never throw into the learner's path: they are refused
 * and logged, so a late provider callback cannot resurrect a stopped session.
 */
export function guardSessionTransition(
  sessionId: string,
  from: SessionState,
  to: SessionState,
  correlationId?: string | null,
): boolean {
  if (canTransitionSession(from, to)) return true;
  void recordInvalidTransition("session", sessionId, from, to, correlationId ?? null);
  return false;
}

export function guardVmTransition(vmId: string, from: PoolVmState, to: PoolVmState): boolean {
  if (canTransitionVm(from, to)) return true;
  void recordInvalidTransition("vm", vmId, from, to, null);
  return false;
}

async function recordInvalidTransition(
  entityType: "session" | "vm",
  entityId: string,
  from: string,
  to: string,
  correlationId: string | null,
) {
  try {
    const { appendEntityLifecycleEvent } = await import("@/lib/db/lifecycle-events.repo.server");
    await appendEntityLifecycleEvent({
      entityType,
      entityId,
      phase: "ERROR",
      status: "warning",
      detail: `Refused invalid ${entityType} transition ${from} -> ${to}.`,
      correlationId,
      metadata: { from, to, reason: "invalid_transition" },
    });
  } catch {
    /* observability must never break a lifecycle action */
  }
}

/** Correlation id for one launch attempt; shared by every event it produces. */
export function newCorrelationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}