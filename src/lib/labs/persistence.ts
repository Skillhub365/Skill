/**
 * Client-safe model for persistent (multi-day) labs.
 *
 * A lab is either:
 *  - `session_based`  — the original disposable, time-boxed behaviour, or
 *  - `persistent`     — the learner keeps one machine for an access window and
 *                       spends a total minute allowance across many sessions.
 *
 * Everything here is pure so the admin console, the learner UI and the server
 * evaluate access with exactly the same rules.
 */

export type LabMode = "session_based" | "persistent";

export const LAB_MODE_LABEL: Record<LabMode, string> = {
  session_based: "Session-based",
  persistent: "Persistent (multi-day)",
};

export type PersistencePolicy = "keep_vm" | "keep_disk" | "snapshot_restore";

export const PERSISTENCE_POLICY_LABEL: Record<PersistencePolicy, string> = {
  keep_vm: "Keep VM allocated (never deallocated)",
  keep_disk: "Deallocate compute, keep disk and state",
  snapshot_restore: "Snapshot & restore (planned)",
};

export const PERSISTENCE_POLICY_HINT: Record<PersistencePolicy, string> = {
  keep_vm: "Fastest resume, highest cost — the machine stays running between sessions.",
  keep_disk: "Recommended. Compute is deallocated on stop; disk, files and installed software survive.",
  snapshot_restore: "Placeholder — snapshots are not taken yet; behaves like keep disk.",
};

/** Defaults used when an administrator switches a lab to persistent mode. */
export const PERSISTENT_DEFAULTS = {
  accessDays: 10,
  allowedMinutes: 1200, // 20 hours
  idleShutdownMinutes: 30,
  persistencePolicy: "keep_disk" as PersistencePolicy,
  resetOnAccessEnd: true,
};

/** Persistent configuration carried on a lab record. */
export interface LabPersistence {
  labMode: LabMode;
  defaultAccessDays: number;
  defaultAllowedMinutes: number;
  idleShutdownMinutes: number;
  persistencePolicy: PersistencePolicy;
  resetOnAccessEnd: boolean;
}

/** Per-learner grant for a persistent lab. */
export interface AssignmentAccess {
  accessStartsAt: string | null;
  accessEndsAt: string | null;
  allowedMinutes: number | null;
  usedMinutes: number;
  remainingMinutes: number;
  persistentVmId: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
}

export type AccessDenialReason =
  | "REVOKED"
  | "NOT_STARTED"
  | "ENDED"
  | "NO_MINUTES"
  | "NOT_CONFIGURED";

export interface AccessEvaluation {
  allowed: boolean;
  reason?: AccessDenialReason;
  message: string;
  remainingMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
}

export function emptyAccess(): AssignmentAccess {
  return {
    accessStartsAt: null,
    accessEndsAt: null,
    allowedMinutes: null,
    usedMinutes: 0,
    remainingMinutes: 0,
    persistentVmId: null,
    lastStartedAt: null,
    lastStoppedAt: null,
  };
}

/**
 * Single source of truth for "may this learner start this persistent lab now?".
 * The server calls it before any cloud work; the UI calls it to explain why a
 * button is disabled.
 */
export function evaluateAccess(
  access: AssignmentAccess,
  options: { status?: string; now?: Date } = {},
): AccessEvaluation {
  const now = options.now ?? new Date();
  const base = {
    remainingMinutes: Math.max(0, access.remainingMinutes),
    startsAt: access.accessStartsAt,
    endsAt: access.accessEndsAt,
  };

  if (options.status === "revoked") {
    return { allowed: false, reason: "REVOKED", message: "Access to this lab has been revoked.", ...base };
  }
  if (!access.accessStartsAt || !access.accessEndsAt || access.allowedMinutes == null) {
    return {
      allowed: false,
      reason: "NOT_CONFIGURED",
      message: "An administrator has not set your access window and hours for this lab yet.",
      ...base,
    };
  }
  if (now.getTime() < new Date(access.accessStartsAt).getTime()) {
    return {
      allowed: false,
      reason: "NOT_STARTED",
      message: `Access opens on ${formatDate(access.accessStartsAt)}.`,
      ...base,
    };
  }
  if (now.getTime() > new Date(access.accessEndsAt).getTime()) {
    return {
      allowed: false,
      reason: "ENDED",
      message: `Access ended on ${formatDate(access.accessEndsAt)}.`,
      ...base,
    };
  }
  if (base.remainingMinutes <= 0) {
    return {
      allowed: false,
      reason: "NO_MINUTES",
      message: "You have used all of your allocated hours for this lab.",
      ...base,
    };
  }
  return { allowed: true, message: `${formatHours(base.remainingMinutes)} remaining.`, ...base };
}

export function formatHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Percentage of the allowance already consumed (0-100). */
export function usedPercent(access: AssignmentAccess): number {
  if (!access.allowedMinutes) return 0;
  return Math.min(100, Math.round((access.usedMinutes / access.allowedMinutes) * 100));
}

/** ISO date (yyyy-mm-dd) helpers for the admin date inputs. */
export function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "";
}

export function fromDateInput(value: string, endOfDay = false): string | null {
  if (!value) return null;
  return new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`).toISOString();
}
