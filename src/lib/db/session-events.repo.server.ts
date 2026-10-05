import { db } from "./client.server";

/**
 * Durable session audit trail.
 *
 * Every meaningful transition of a lab session is appended here. The registry
 * keeps no authoritative audit history of its own: `listAudit()` reads this
 * table, so the trail survives restarts and is identical on every instance.
 */

export type SessionEventType =
  | "session.created"
  | "session.active"
  | "session.extended"
  | "session.stopping"
  | "session.stopped"
  | "session.expired"
  | "session.error"
  | "session.rehydrated"
  | "session.heartbeat"
  | "connection.created"
  | "connection.connected"
  | "connection.failed"
  | "connection.terminated"
  | "connection.cleaned"
  | "endpoint.discovered"
  | "endpoint.cleared"
  | "vm.deallocated"
  | "cleanup.started"
  | "cleanup.completed"
  | "cleanup.failed"
  | (string & {});

export interface SessionEventInput {
  sessionId: string;
  eventType: SessionEventType;
  phase?: string | null;
  message?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SessionEventRecord {
  id: string;
  seq: number;
  sessionId: string;
  at: string;
  eventType: string;
  phase: string | null;
  message: string | null;
  correlationId: string | null;
  metadata: Record<string, unknown>;
}

/** Fields that must never reach a durable log or the browser. */
const REDACTED = /^(password|secret|token|authToken|privateIp|private_ip|clientSecret|rdpPassword|apiKey)$/i;

function safeMetadata(metadata: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (REDACTED.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Append-only write. Never throws into the lifecycle path. */
export async function appendSessionEvent(input: SessionEventInput): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("session_events").insert({
      session_id: input.sessionId,
      event_type: input.eventType,
      phase: input.phase ?? null,
      message: input.message ?? null,
      correlation_id: input.correlationId ?? null,
      metadata: safeMetadata(input.metadata) as never,
    } as never);
  } catch (error) {
    console.error("[session-events] write failed", (error as Error)?.message);
  }
}

function toRecord(row: Record<string, unknown>): SessionEventRecord {
  return {
    id: String(row["id"]),
    seq: Number(row["seq"] ?? 0),
    sessionId: String(row["session_id"]),
    at: String(row["at"]),
    eventType: String(row["event_type"]),
    phase: (row["phase"] as string | null) ?? null,
    message: (row["message"] as string | null) ?? null,
    correlationId: (row["correlation_id"] as string | null) ?? null,
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
  };
}

export async function listSessionEvents(sessionId: string, limit = 200): Promise<SessionEventRecord[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("session_events")
      .select("*")
      .eq("session_id", sessionId)
      .order("seq", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => toRecord(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** Tenant-wide feed used by the admin session audit view. */
export async function listRecentSessionEvents(sessionIds: string[], limit = 200): Promise<SessionEventRecord[]> {
  if (!sessionIds.length) return [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("session_events")
      .select("*")
      .in("session_id", sessionIds.slice(0, 200))
      .order("seq", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => toRecord(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** Newest events across all sessions — the platform-wide runtime audit feed. */
export async function listAllRecentSessionEvents(limit = 200): Promise<SessionEventRecord[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("session_events")
      .select("*")
      .order("seq", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => toRecord(row as Record<string, unknown>));
  } catch {
    return [];
  }
}
