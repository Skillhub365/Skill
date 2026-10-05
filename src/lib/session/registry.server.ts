import {
  DEFAULT_MAX_EXTENSION_MINUTES,
  HEARTBEAT_GRACE_MS,
  isLive,
  type SessionConnectionStatus,
  type SessionEndReason,
  type SessionRecord,
  type SessionSnapshot,
  type SessionState,
} from "./types";
import {
  appendSessionEvent,
  listAllRecentSessionEvents,
  listSessionEvents,
} from "@/lib/db/session-events.repo.server";
import {
  findLiveSession as dbFindLiveSession,
  loadLiveSessions,
  loadSession,
  persistSession,
} from "@/lib/db/sessions.repo.server";

/**
 * Server-side session registry. This — not the browser timer — is the source of
 * truth for expiry. Every read re-evaluates the clock and reclaims the VM when
 * the session has expired or the learner's browser stopped reporting in, so a
 * closed tab can never leave a VM running forever.
 */

export interface CreateSessionInput {
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
  durationMinutes: number;
  maxExtensionMinutes?: number;
  tenantId?: string | null;
  /** Idempotency key; a retry with the same key reuses the session. */
  launchKey?: string | null;
  /** Machine size, recorded for usage and cost reporting. */
  vmSize?: string | null;
  /** Persistent labs: the grant this session spends minutes from. */
  assignmentId?: string | null;
  labMode?: import("@/lib/labs/persistence").LabMode;
}

export interface AuditEvent {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  action: string;
  detail: string;
  at: string;
}

interface RegistryState {
  sessions: Map<string, SessionRecord>;
  tenants: Map<string, string | null>;
  sweeping: boolean;
  hydrated: Promise<void> | null;
}

let state: RegistryState | null = null;

function registry(): RegistryState {
  if (!state) {
    state = { sessions: new Map(), tenants: new Map(), sweeping: false, hydrated: null };
    startSweep(state);
  }
  return state;
}

/**
 * The in-memory map is a cache over the durable table, not the source of
 * truth. On a cold worker we rehydrate every session that may still hold
 * cloud resources, so expiry and VM ownership survive restarts and are shared
 * across instances.
 */
async function ensureLoaded(): Promise<RegistryState> {
  const s = registry();
  if (!s.hydrated) {
    s.hydrated = loadLiveSessions()
      .then((records) => {
        for (const record of records) if (!s.sessions.has(record.id)) s.sessions.set(record.id, record);
      })
      .catch(() => undefined);
  }
  await s.hydrated;
  return s;
}

/** Write-through: every transition lands in the database. */
function persist(session: SessionRecord) {
  void persistSession(session, registry().tenants.get(session.id) ?? null);
}

/** Background reclaim loop. Started lazily (never at module scope). */
function startSweep(s: RegistryState) {
  if (s.sweeping) return;
  s.sweeping = true;
  try {
    setInterval(() => {
      void Promise.all([...s.sessions.keys()].map((id) => evaluate(id))).catch(() => null);
    }, 15_000);
  } catch {
    /* runtimes without long-lived timers still reclaim lazily on read */
  }
}

/**
 * Durable audit write. The registry keeps no authoritative in-memory trail:
 * every transition is appended to `session_events`, so the history survives a
 * restart and is identical on every instance.
 */
function audit(sessionId: string, session: SessionRecord | undefined, action: string, detail: string) {
  void appendSessionEvent({
    sessionId,
    eventType: action,
    message: detail,
    phase: session?.status ?? null,
    metadata: {
      userId: session?.userId ?? "system",
      userName: session?.userName ?? "System",
      vmName: session?.vmName ?? null,
    },
  });
}

/** Reads the durable trail. Empty until the first transition is recorded. */
export async function listAudit(sessionId?: string): Promise<AuditEvent[]> {
  const rows = sessionId ? await listSessionEvents(sessionId) : await listAllRecentSessionEvents();
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    userId: String(row.metadata["userId"] ?? "system"),
    userName: String(row.metadata["userName"] ?? "System"),
    action: row.eventType,
    detail: row.message ?? "",
    at: row.at,
  }));
}

function snapshot(session: SessionRecord): SessionSnapshot {
  const remainingMs = isLive(session.status)
    ? Math.max(0, new Date(session.expiryTime).getTime() - Date.now())
    : 0;
  const extendableMinutes = Math.max(0, session.maxExtensionMinutes - session.extendedMinutes);
  return {
    session,
    serverTime: new Date().toISOString(),
    remainingMs,
    canExtend: isLive(session.status) && extendableMinutes > 0,
    extendableMinutes,
  };
}

/** Idempotent: an in-flight session for the same user+lab is returned as-is. */
export async function findLiveSessionFor(userId: string, labId: string): Promise<SessionRecord | null> {
  const s = await ensureLoaded();
  for (const session of s.sessions.values()) {
    if (session.userId === userId && session.labId === labId && isLive(session.status)) return session;
  }
  const stored = await dbFindLiveSession(userId, labId);
  if (stored) s.sessions.set(stored.id, stored);
  return stored;
}

/** Idempotency by launch key: survives a restart because it reads the table. */
export async function findSessionByLaunchKey(launchKey: string): Promise<SessionRecord | null> {
  const s = await ensureLoaded();
  for (const session of s.sessions.values()) {
    if (session.launchKey === launchKey && isLive(session.status)) return session;
  }
  const { findSessionByLaunchKeyRow } = await import("@/lib/db/sessions.repo.server");
  const stored = await findSessionByLaunchKeyRow(launchKey);
  if (stored) s.sessions.set(stored.id, stored);
  return stored;
}

export async function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  await ensureLoaded();
  if (input.launchKey) {
    const dup = await findSessionByLaunchKey(input.launchKey);
    if (dup) return dup;
  }
  await ensureLoaded();
  const now = Date.now();
  const session: SessionRecord = {
    id: `ses-${Math.random().toString(16).slice(2, 8)}`,
    userId: input.userId,
    userName: input.userName,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    workspaceSlug: input.workspaceSlug,
    labId: input.labId,
    labName: input.labName,
    vmId: input.vmId,
    vmName: input.vmName,
    provider: input.provider,
    createdAt: new Date(now).toISOString(),
    startTime: new Date(now).toISOString(),
    expiryTime: new Date(now + input.durationMinutes * 60_000).toISOString(),
    endedAt: null,
    durationMinutes: input.durationMinutes,
    extendedMinutes: 0,
    maxExtensionMinutes: input.maxExtensionMinutes ?? DEFAULT_MAX_EXTENSION_MINUTES,
    status: "STARTING",
    connectionStatus: "NONE",
    endReason: null,
    lastSeenAt: new Date(now).toISOString(),
    message: "Session created; the orchestrator is starting your VM.",
    launchKey: input.launchKey ?? null,
    vmSize: input.vmSize ?? null,
    assignmentId: input.assignmentId ?? null,
    labMode: input.labMode ?? "session_based",
    billableMinutes: null,
  };
  registry().sessions.set(session.id, session);
  registry().tenants.set(session.id, input.tenantId ?? null);
  await persistSession(session, input.tenantId ?? null);
  audit(session.id, session, "session.created", `Session created for lab ${session.labName} (${input.durationMinutes} min).`);
  return session;
}

/** Rebuild a session the worker no longer remembers, from a client snapshot. */
export function adoptSession(record: SessionRecord): SessionRecord {
  const existing = registry().sessions.get(record.id);
  if (existing) return existing;
  registry().sessions.set(record.id, record);
  persist(record);
  audit(record.id, record, "session.rehydrated", "Session state rebuilt after a server restart.");
  return record;
}

export async function getSessionRaw(id: string): Promise<SessionRecord | null> {
  const s = await ensureLoaded();
  const cached = s.sessions.get(id);
  if (cached) return cached;
  const stored = await loadSession(id);
  if (stored) s.sessions.set(stored.id, stored);
  return stored;
}

/** Every session the server knows about (used by the automated reaper). */
export async function listSessions(): Promise<SessionRecord[]> {
  const s = await ensureLoaded();
  return [...s.sessions.values()];
}

/** Owner of a VM according to the server-side registry (never client input). */
export async function findVmOwner(vmId: string): Promise<string | null> {
  const s = await ensureLoaded();
  for (const session of s.sessions.values()) {
    if (session.vmId === vmId) return session.userId;
  }
  return null;
}

/** Sessions bound to a machine — used to route provider events to streams. */
export async function listSessionIdsForVm(vmId: string): Promise<string[]> {
  const s = await ensureLoaded();
  const ids: string[] = [];
  for (const session of s.sessions.values()) {
    if (session.vmId === vmId && isLive(session.status)) ids.push(session.id);
  }
  return ids;
}

async function stopVmFor(session: SessionRecord) {
  try {
    const { orchestrator } = await import("@/lib/vm/orchestrator.server");
    await orchestrator.stopVM(session.vmId, session.provider);
  } catch {
    /* VM already gone in the provider */
  }
}

async function terminateConnectionFor(session: SessionRecord) {
  try {
    const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
    await remoteDesktop().terminateConnection(session.id);
  } catch {
    /* no active connection */
  }
}

/** Push a lifecycle phase to the learner's live stream. */
async function broadcast(session: SessionRecord, phase: "STOPPING" | "STOPPED" | "ERROR", message: string) {
  try {
    const { publishLifecycle } = await import("@/lib/realtime/bus.server");
    await publishLifecycle({ sessionId: session.id, vmId: session.vmId, phase, message });
  } catch {
    /* streaming is best-effort; session state remains authoritative */
  }
}

/**
 * Session teardown, in the required order:
 * terminate the gateway connection -> deallocate the Azure VM -> close the
 * session -> record audit events. Shared by manual stop and automatic expiry.
 */
async function teardown(session: SessionRecord, status: SessionState, reason: SessionEndReason, message: string) {
  session.status = "DISCONNECTING";
  await broadcast(session, "STOPPING", message);
  await terminateConnectionFor(session);
  session.connectionStatus = "DISCONNECTED";
  audit(session.id, session, "connection.terminated", "Remote desktop connection revoked on the gateway.");
  await stopVmFor(session);
  audit(session.id, session, "vm.deallocated", `VM ${session.vmName} stopped and deallocated.`);
  session.status = status;
  session.endReason = reason;
  session.endedAt = new Date().toISOString();
  session.message = message;
  await accountUsage(session);
  persist(session);
  audit(session.id, session, `session.${status.toLowerCase()}`, `${message} VM ${session.vmName} deallocated.`);
  await broadcast(session, "STOPPED", message);
  return session;
}

/**
 * Charge the elapsed wall-clock time of a finished session against the
 * learner's persistent allowance. Capped by the session's own budget so a
 * stuck clock can never overspend a grant.
 */
async function accountUsage(session: SessionRecord) {
  const started = new Date(session.startTime).getTime();
  const ended = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const budget = session.durationMinutes + (session.extendedMinutes ?? 0);
  const minutes = Math.max(0, Math.min(budget, Math.ceil((ended - started) / 60_000)));
  session.billableMinutes = minutes;
  if (!session.assignmentId || session.labMode !== "persistent" || minutes <= 0) return;
  try {
    const { chargeUsage } = await import("@/lib/labs/persistent-vm.server");
    const access = await chargeUsage(session.assignmentId, minutes);
    if (access) {
      audit(
        session.id,
        session,
        "assignment.usage_recorded",
        `${minutes} min charged to the lab allowance; ${Math.max(0, access.remainingMinutes)} min remaining.`,
      );
    }
  } catch {
    /* accounting is retried by the reaper sweep */
  }
}

/**
 * Readiness timeout / provider failure: release everything in the same order
 * as a normal stop, then mark the session ERROR and notify the learner.
 */
export async function failSession(id: string, message: string): Promise<SessionRecord | null> {
  const session = await getSessionRaw(id);
  if (!session) return null;
  if (!isLive(session.status)) return session;
  await terminateConnectionFor(session);
  session.connectionStatus = "DISCONNECTED";
  await stopVmFor(session);
  session.status = "ERROR";
  session.endReason = "vm_failure";
  session.endedAt = new Date().toISOString();
  session.message = message;
  persist(session);
  audit(session.id, session, "session.error", `${message} VM ${session.vmName} deallocated.`);
  await broadcast(session, "ERROR", message);
  return session;
}

/** Re-evaluate the clock and reclaim resources when needed. */
export async function evaluate(id: string): Promise<SessionRecord | null> {
  const session = await getSessionRaw(id);
  if (!session) return null;
  if (!isLive(session.status)) return session;

  const now = Date.now();
  if (now >= new Date(session.expiryTime).getTime()) {
    return teardown(session, "EXPIRED", "expired", "Session time elapsed.");
  }
  const idleFor = now - new Date(session.lastSeenAt).getTime();
  if (idleFor > HEARTBEAT_GRACE_MS) {
    return teardown(
      session,
      "STOPPED",
      "abandoned",
      "No browser heartbeat received; the session was reclaimed automatically.",
    );
  }
  return session;
}

export async function getSession(id: string): Promise<SessionSnapshot | null> {
  const session = await evaluate(id);
  return session ? snapshot(session) : null;
}

export async function heartbeat(
  id: string,
  patch?: { connectionStatus?: SessionConnectionStatus; vmStatus?: string },
): Promise<SessionSnapshot | null> {
  const session = await getSessionRaw(id);
  if (!session) return null;
  if (isLive(session.status)) {
    session.lastSeenAt = new Date().toISOString();
    if (patch?.connectionStatus) {
      session.connectionStatus = patch.connectionStatus;
      if (patch.connectionStatus === "CONNECTED" && session.status === "STARTING") {
        session.status = "ACTIVE";
        session.message = "Remote connection established; the session clock is running.";
        audit(session.id, session, "session.active", "Remote desktop connected.");
      }
      if (patch.connectionStatus === "ERROR") {
        session.message = "The remote desktop connection failed.";
      }
    }
    if (patch?.vmStatus === "READY" && session.status === "STARTING") {
      session.message = "VM is ready; connect to start working.";
    }
    if (patch?.vmStatus === "ERROR") {
      session.status = "ERROR";
      session.endReason = "vm_failure";
      session.endedAt = new Date().toISOString();
      session.message = "The VM failed to start.";
      audit(session.id, session, "session.error", "VM start failure reported by the orchestrator.");
    }
    persist(session);
  }
  const evaluated = await evaluate(id);
  return evaluated ? snapshot(evaluated) : null;
}

export async function extendSession(id: string, minutes: number): Promise<{ snapshot: SessionSnapshot | null; error?: string }> {
  const session = await evaluate(id);
  if (!session) return { snapshot: null, error: "Session not found" };
  if (!isLive(session.status)) return { snapshot: snapshot(session), error: "This session has already ended" };
  const allowance = session.maxExtensionMinutes - session.extendedMinutes;
  if (allowance <= 0) return { snapshot: snapshot(session), error: "Maximum extension reached" };
  const granted = Math.min(minutes, allowance);
  session.extendedMinutes += granted;
  session.expiryTime = new Date(new Date(session.expiryTime).getTime() + granted * 60_000).toISOString();
  session.lastSeenAt = new Date().toISOString();
  session.message = `Session extended by ${granted} minutes.`;
  persist(session);
  audit(session.id, session, "session.extended", `Extended by ${granted} min (total ${session.extendedMinutes}/${session.maxExtensionMinutes}).`);
  void import("@/lib/observability/metrics.server")
    .then(({ recordMetric, METRIC }) =>
      recordMetric(METRIC.sessionExtended, granted, {
        sessionId: session.id,
        userId: session.userId,
        workspaceId: session.workspaceId,
        labId: session.labId,
      }),
    )
    .catch(() => null);
  try {
    const { orchestrator } = await import("@/lib/vm/orchestrator.server");
    await orchestrator.extendVM(session.vmId, session.expiryTime, session.provider);
  } catch {
    /* provider does not support lease extension */
  }
  return { snapshot: snapshot(session) };
}

export async function stopSession(id: string, reason: SessionEndReason = "user_stopped"): Promise<SessionSnapshot | null> {
  const session = await getSessionRaw(id);
  if (!session) return null;
  if (!isLive(session.status)) return snapshot(session);
  await teardown(session, "STOPPED", reason, reason === "user_stopped" ? "Learner stopped the lab." : "Session stopped.");
  void import("@/lib/observability/metrics.server")
    .then(({ recordMetric, METRIC }) =>
      recordMetric(reason === "expired" ? METRIC.sessionExpired : METRIC.sessionStopped, 1, {
        sessionId: session.id,
        userId: session.userId,
        workspaceId: session.workspaceId,
        labId: session.labId,
        vmId: session.vmId,
        metadata: { reason },
      }),
    )
    .catch(() => null);
  return snapshot(session);
}
