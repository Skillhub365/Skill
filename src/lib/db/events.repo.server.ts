import { db } from "./client.server";
import type { PlatformEventType } from "@/lib/activity";

/**
 * Durable audit writes. These are best-effort: an audit failure must never
 * fail the operation the user asked for, so every helper swallows errors after
 * logging them server-side.
 */

export interface ActivityInput {
  tenantId: string | null;
  action: PlatformEventType | string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  targetType?: string;
  targetId?: string | null;
  /** Human-readable subject shown in the console feed. */
  target?: string;
  workspaceId?: string | null;
  outcome?: "success" | "failure";
  detail?: string;
  errorCode?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("activity_logs").insert({
      tenant_id: input.tenantId,
      action: input.action,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? "System",
      actor_role: input.actorRole ?? null,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      workspace_id: input.workspaceId ?? null,
      outcome: input.outcome ?? "success",
      detail: input.detail ?? null,
      error_code: input.errorCode ?? null,
      correlation_id: input.correlationId ?? null,
      metadata: { ...(input.metadata ?? {}), ...(input.target ? { target: input.target } : {}) },
    });
  } catch (error) {
    console.error("[audit] activity log write failed", error);
  }
}

export interface SessionEventInput {
  sessionId: string;
  eventType: string;
  phase?: string | null;
  message?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordSessionEvent(input: SessionEventInput): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("session_events").insert({
      session_id: input.sessionId,
      event_type: input.eventType,
      phase: input.phase ?? null,
      message: input.message ?? null,
      correlation_id: input.correlationId ?? null,
      metadata: (input.metadata ?? {}) as never,
    });
  } catch (error) {
    console.error("[audit] session event write failed", error);
  }
}

export interface LifecycleEventInput {
  tenantId: string | null;
  entityType: string;
  entityId: string;
  phase: string;
  status: string;
  correlationId?: string | null;
  durationMs?: number | null;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordLifecycleEvent(input: LifecycleEventInput): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("lifecycle_events").insert({
      tenant_id: input.tenantId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      phase: input.phase,
      status: input.status,
      correlation_id: input.correlationId ?? null,
      duration_ms: input.durationMs ?? null,
      detail: input.detail ?? null,
      metadata: (input.metadata ?? {}) as never,
    });
  } catch (error) {
    console.error("[audit] lifecycle event write failed", error);
  }
}

/** Read the audit trail for one session (learner + admin session timeline). */
export async function listSessionEvents(sessionId: string) {
  const supabase = await db();
  const { data } = await supabase
    .from("session_events")
    .select("id, session_id, at, event_type, phase, message, metadata")
    .eq("session_id", sessionId)
    .order("at", { ascending: false })
    .limit(100);
  return data ?? [];
}
