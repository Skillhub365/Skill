/** Client-safe session lifecycle types. */

/**
 * Durable launch state machine. Every transition is persisted (see
 * `state-machine.ts`), so a restart resumes from the last recorded phase.
 *
 *   REQUESTED -> ALLOCATING -> STARTING -> BOOTING -> READY -> ACTIVE
 *              -> STOPPING -> STOPPED | EXPIRED | ERROR
 */
export type SessionState =
  | "REQUESTED"
  | "ALLOCATING"
  | "CREATING"
  | "STARTING"
  | "BOOTING"
  | "READY"
  | "ACTIVE"
  | "DISCONNECTING"
  | "STOPPING"
  | "EXPIRED"
  | "STOPPED"
  | "ERROR";

export type SessionConnectionStatus = "NONE" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR";

export type SessionEndReason = "user_stopped" | "expired" | "abandoned" | "vm_failure" | "connection_failure" | null;

export interface SessionRecord {
  id: string;
  /** Stable id shared by every log line and lifecycle event of one launch. */
  correlationId?: string;
  userId: string;
  userName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  labId: string;
  labName: string;
  vmId: string;
  vmName: string;
  provider: "Azure" | "AWS" | "GCP";
  /** ISO timestamps — the server is always the source of truth. */
  createdAt: string;
  startTime: string;
  expiryTime: string;
  endedAt: string | null;
  durationMinutes: number;
  extendedMinutes: number;
  maxExtensionMinutes: number;
  status: SessionState;
  connectionStatus: SessionConnectionStatus;
  endReason: SessionEndReason;
  lastSeenAt: string;
  message: string;
  /** Idempotency key of the launch that created this session. */
  launchKey?: string | null;
  /** Machine size, captured so lab hours can be costed after the fact. */
  vmSize?: string | null;
  /** Persistent labs only: the grant this session is billed against. */
  assignmentId?: string | null;
  /** "persistent" sessions resume a dedicated machine and spend an allowance. */
  labMode?: import("../labs/persistence").LabMode;
  /** Minutes charged to the assignment allowance once the session ended. */
  billableMinutes?: number | null;
}

/** What the API returns: the record plus authoritative clock information. */
export interface SessionSnapshot {
  session: SessionRecord;
  serverTime: string;
  remainingMs: number;
  canExtend: boolean;
  extendableMinutes: number;
}

export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  REQUESTED: "Requested",
  ALLOCATING: "Allocating",
  CREATING: "Creating",
  STARTING: "Starting",
  BOOTING: "Booting",
  READY: "Ready",
  ACTIVE: "Active",
  DISCONNECTING: "Disconnecting",
  STOPPING: "Stopping",
  EXPIRED: "Expired",
  STOPPED: "Stopped",
  ERROR: "Error",
};

export const LIVE_SESSION_STATES: SessionState[] = [
  "REQUESTED",
  "ALLOCATING",
  "CREATING",
  "STARTING",
  "BOOTING",
  "READY",
  "ACTIVE",
  "DISCONNECTING",
  "STOPPING",
];

/** States that mean "still launching" — subject to the launch timeout. */
export const LAUNCHING_SESSION_STATES: SessionState[] = [
  "REQUESTED",
  "ALLOCATING",
  "CREATING",
  "STARTING",
  "BOOTING",
  "READY",
];

export function isLive(status: SessionState) {
  return LIVE_SESSION_STATES.includes(status);
}

export function isLaunching(status: SessionState) {
  return LAUNCHING_SESSION_STATES.includes(status);
}

export type TimerTier = "normal" | "warning" | "critical" | "expired";

/** Timer tiers: warning under 15 min, critical under 5 min. */
export function timerTier(remainingMs: number): TimerTier {
  if (remainingMs <= 0) return "expired";
  const minutes = remainingMs / 60_000;
  if (minutes <= 5) return "critical";
  if (minutes <= 15) return "warning";
  return "normal";
}

export const TIMER_TIER_CLASS: Record<TimerTier, string> = {
  normal: "border-border text-foreground",
  warning: "border-amber-500/60 bg-amber-500/10 text-amber-700",
  critical: "border-destructive/60 bg-destructive/10 text-destructive animate-pulse",
  expired: "border-destructive bg-destructive text-destructive-foreground",
};

export function formatTimer(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Administrator-configured policy for the MVP. */
export const DEFAULT_MAX_EXTENSION_MINUTES = 60;
export const EXTENSION_STEP_MINUTES = 30;
/** A session with no browser heartbeat for this long is reclaimed server-side. */
export const HEARTBEAT_GRACE_MS = 120_000;
/**
 * A launch that never reaches ACTIVE within this budget is failed, the VM is
 * deallocated and returned to the pool. Guards against a crash between
 * "allocated" and "connected".
 */
export const LAUNCH_TIMEOUT_MS = 15 * 60_000;
/** A READY session nobody ever connects to is reclaimed after this long. */
export const CONNECT_GRACE_MS = 10 * 60_000;
