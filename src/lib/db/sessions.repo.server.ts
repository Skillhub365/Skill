import { db } from "./client.server";
import { hourlyRateCents } from "@/lib/cost/pricing";
import type { SessionRecord } from "@/lib/session/types";

/**
 * Durable storage for session lifecycle state.
 *
 * Sessions outlive the worker that created them: state is written through to
 * the database on every transition, so expiry, heartbeats and VM ownership
 * survive a restart and are consistent across app instances.
 */

interface SessionRow {
  id: string;
  tenant_id: string | null;
  workspace_id: string | null;
  lab_id: string | null;
  user_id: string;
  vm_id: string | null;
  vm_name: string | null;
  provider: string;
  status: string;
  connection_status: string;
  message: string | null;
  duration_minutes: number;
  extended_minutes: number;
  extension_count: number;
  max_extension_minutes: number;
  started_at: string;
  expires_at: string;
  last_heartbeat_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  created_at: string;
  workspace_slug: string | null;
  workspace_name: string | null;
  lab_title: string | null;
  user_name: string | null;
  launch_key: string | null;
  vm_size: string | null;
  error_code: string | null;
  state_changed_at: string | null;
  assignment_id?: string | null;
  lab_mode?: string | null;
  billable_minutes?: number | null;
}

const LIVE_STATES = [
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

export function rowToRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name ?? "Learner",
    workspaceId: row.workspace_id ?? "",
    workspaceName: row.workspace_name ?? "",
    workspaceSlug: row.workspace_slug ?? "",
    labId: row.lab_id ?? "",
    labName: row.lab_title ?? "",
    vmId: row.vm_id ?? "",
    vmName: row.vm_name ?? "",
    provider: (row.provider as SessionRecord["provider"]) ?? "Azure",
    createdAt: row.created_at,
    startTime: row.started_at,
    expiryTime: row.expires_at,
    endedAt: row.ended_at,
    durationMinutes: row.duration_minutes,
    extendedMinutes: row.extended_minutes,
    maxExtensionMinutes: row.max_extension_minutes,
    status: row.status as SessionRecord["status"],
    connectionStatus: row.connection_status as SessionRecord["connectionStatus"],
    endReason: (row.ended_reason as SessionRecord["endReason"]) ?? null,
    lastSeenAt: row.last_heartbeat_at ?? row.started_at,
    message: row.message ?? "",
    launchKey: row.launch_key ?? null,
    vmSize: row.vm_size ?? null,
    assignmentId: row.assignment_id ?? null,
    labMode: row.lab_mode === "persistent" ? "persistent" : "session_based",
    billableMinutes: row.billable_minutes ?? null,
  };
}

function recordToRow(record: SessionRecord, tenantId: string | null) {
  return {
    id: record.id,
    tenant_id: tenantId,
    workspace_id: record.workspaceId || null,
    lab_id: record.labId || null,
    user_id: record.userId,
    vm_id: record.vmId || null,
    vm_name: record.vmName || null,
    provider: record.provider,
    status: record.status,
    connection_status: record.connectionStatus,
    message: record.message,
    duration_minutes: record.durationMinutes,
    extended_minutes: record.extendedMinutes,
    max_extension_minutes: record.maxExtensionMinutes,
    started_at: record.startTime,
    expires_at: record.expiryTime,
    last_heartbeat_at: record.lastSeenAt,
    ended_at: record.endedAt,
    ended_reason: record.endReason,
    workspace_slug: record.workspaceSlug || null,
    workspace_name: record.workspaceName || null,
    lab_title: record.labName || null,
    user_name: record.userName || null,
    launch_key: record.launchKey ?? null,
    vm_size: record.vmSize ?? null,
    assignment_id: record.assignmentId ?? null,
    lab_mode: record.labMode ?? "session_based",
    billable_minutes: record.billableMinutes ?? null,
    // Estimated rate is frozen onto the session so later rate-card changes do
    // not rewrite the cost of hours already consumed.
    hourly_rate_cents: Math.round(hourlyRateCents(record.vmSize)),
    state_changed_at: new Date().toISOString(),
  };
}

/**
 * Idempotency lookup. A retried START LAB carrying the same launch key must
 * resolve to the session the first call created, never to a second VM.
 */
export async function findSessionByLaunchKeyRow(launchKey: string): Promise<SessionRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("launch_key", launchKey)
      .in("status", LIVE_STATES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? rowToRecord(data as unknown as SessionRow) : null;
  } catch {
    return null;
  }
}

/** Write-through persistence. Never throws into the lifecycle path. */
export async function persistSession(record: SessionRecord, tenantId: string | null = null): Promise<void> {
  try {
    const supabase = await db();
    await supabase
      .from("sessions")
      .upsert(recordToRow(record, tenantId) as never, { onConflict: "id" });
  } catch (error) {
    console.error("session persist failed", (error as Error)?.message);
  }
}

/** Every session that may still hold cloud resources. */
export async function loadLiveSessions(): Promise<SessionRecord[]> {
  try {
    const supabase = await db();
    const { data } = await supabase.from("sessions").select("*").in("status", LIVE_STATES).limit(500);
    return (data ?? []).map((row) => rowToRecord(row as unknown as SessionRow));
  } catch {
    return [];
  }
}

export async function loadSession(id: string): Promise<SessionRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
    return data ? rowToRecord(data as unknown as SessionRow) : null;
  } catch {
    return null;
  }
}

/** Idempotency helper: an in-flight session for the same learner + lab. */
export async function findLiveSession(userId: string, labId: string): Promise<SessionRecord | null> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("lab_id", labId)
      .in("status", LIVE_STATES)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? rowToRecord(data as unknown as SessionRow) : null;
  } catch {
    return null;
  }
}

export async function listSessionsForUser(userId: string, limit = 50): Promise<SessionRecord[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => rowToRecord(row as unknown as SessionRow));
  } catch {
    return [];
  }
}
