import { db } from "./client.server";
import { PHASE_PROGRESS, type LifecycleEvent, type LifecyclePhase, type LifecycleSource } from "@/lib/cloud/types";

/**
 * Durable lifecycle event log — the authoritative history behind the SSE
 * stream. `seq` is a database identity column, so ordering is stable across
 * app instances and a browser that reconnects after a restart still receives
 * exactly the events it missed.
 */

export interface AppendLifecycleInput {
  sessionId: string;
  vmId: string;
  phase: LifecyclePhase;
  message: string;
  source: LifecycleSource;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

/** sessionId -> tenantId, resolved once per worker. */
let tenantCache: Map<string, string | null> | null = null;

async function tenantFor(sessionId: string): Promise<string | null> {
  if (!tenantCache) tenantCache = new Map();
  if (tenantCache.has(sessionId)) return tenantCache.get(sessionId) ?? null;
  try {
    const supabase = await db();
    const { data } = await supabase.from("sessions").select("tenant_id").eq("id", sessionId).maybeSingle();
    const tenantId = (data?.tenant_id as string | null) ?? null;
    tenantCache.set(sessionId, tenantId);
    return tenantId;
  } catch {
    return null;
  }
}

function rowToEvent(row: Record<string, unknown>): LifecycleEvent {
  const phase = String(row["phase"]) as LifecyclePhase;
  return {
    seq: Number(row["seq"] ?? 0),
    sessionId: String(row["session_id"] ?? ""),
    vmId: String(row["vm_id"] ?? ""),
    phase,
    message: String(row["message"] ?? row["detail"] ?? ""),
    progress: Number(row["progress"] ?? PHASE_PROGRESS[phase] ?? 0),
    source: (row["source"] as LifecycleSource) ?? "controller",
    at: String(row["at"]),
  };
}

/**
 * Persist one lifecycle event and return it with its durable sequence number.
 * Returns null when the write fails so the caller can fall back to a local
 * sequence for live fanout only.
 */
export async function appendLifecycleEvent(input: AppendLifecycleInput): Promise<LifecycleEvent | null> {
  try {
    const supabase = await db();
    const { data, error } = await supabase
      .from("lifecycle_events")
      .insert({
        tenant_id: await tenantFor(input.sessionId),
        session_id: input.sessionId,
        vm_id: input.vmId,
        entity_type: "session",
        entity_id: input.sessionId,
        phase: input.phase,
        status: input.phase === "ERROR" ? "failure" : "ok",
        source: input.source,
        progress: PHASE_PROGRESS[input.phase],
        message: input.message,
        detail: input.message,
        correlation_id: input.correlationId ?? null,
        metadata: (input.metadata ?? {}) as never,
      } as never)
      .select("seq, at, session_id, vm_id, phase, message, progress, source")
      .single();
    if (error || !data) return null;
    return rowToEvent(data as Record<string, unknown>);
  } catch (error) {
    console.error("[lifecycle] write failed", (error as Error)?.message);
    return null;
  }
}

/** Durable replay for a reconnecting SSE client. */
export interface EntityLifecycleInput {
  entityType: string;
  entityId: string;
  phase: string;
  status?: "ok" | "warning" | "failure" | "info";
  detail?: string;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Lifecycle note for an entity that is not a learner-visible session stream
 * (pool VMs, refused transitions, cleanup actions). Never throws.
 */
export async function appendEntityLifecycleEvent(input: EntityLifecycleInput): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("lifecycle_events").insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      phase: input.phase,
      status: input.status ?? "info",
      detail: input.detail ?? null,
      correlation_id: input.correlationId ?? null,
      metadata: (input.metadata ?? {}) as never,
    } as never);
  } catch {
    /* observability only */
  }
}

export async function lifecycleSince(sessionId: string, afterSeq: number, limit = 200): Promise<LifecycleEvent[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("lifecycle_events")
      .select("seq, at, session_id, vm_id, phase, message, progress, source")
      .eq("session_id", sessionId)
      .gt("seq", afterSeq)
      .order("seq", { ascending: true })
      .limit(limit);
    return (data ?? []).map((row) => rowToEvent(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** Last durable phase for a session — used to suppress duplicate publishes. */
export async function lastLifecyclePhase(sessionId: string): Promise<LifecyclePhase | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("lifecycle_events")
      .select("phase")
      .eq("session_id", sessionId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.phase as LifecyclePhase) ?? null;
  } catch {
    return null;
  }
}
