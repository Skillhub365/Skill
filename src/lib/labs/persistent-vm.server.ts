/**
 * Durable bookkeeping for persistent (multi-day) lab assignments.
 *
 * A persistent assignment owns one machine for the whole access window. Normal
 * stop deallocates compute but keeps the binding, so the learner resumes the
 * same machine with their files intact. Only revoke, reset or end-of-access
 * hands the machine back to the general pool.
 */

import { db } from "@/lib/db/client.server";
import { mapAssignmentAccess, type AssignmentRow } from "@/lib/db/catalog.map";
import type { AssignmentAccess } from "./persistence";

const COLUMNS =
  "id, lab_id, workspace_id, user_id, status, access_starts_at, access_ends_at, allowed_minutes, used_minutes, remaining_minutes, persistent_vm_id, last_started_at, last_stopped_at";

export interface AssignmentGrant {
  id: string;
  labId: string;
  workspaceId: string;
  userId: string;
  status: string;
  access: AssignmentAccess;
}

function toGrant(row: AssignmentRow): AssignmentGrant {
  return {
    id: row.id,
    labId: row.lab_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    status: row.status,
    access: mapAssignmentAccess(row),
  };
}

export async function findAssignment(labId: string, userId: string): Promise<AssignmentGrant | null> {
  const supabase = await db();
  const { data } = await supabase
    .from("lab_assignments")
    .select(COLUMNS)
    .eq("lab_id", labId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? toGrant(data as unknown as AssignmentRow) : null;
}

export async function loadAssignment(id: string): Promise<AssignmentGrant | null> {
  const supabase = await db();
  const { data } = await supabase.from("lab_assignments").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toGrant(data as unknown as AssignmentRow) : null;
}

/** Bind a machine to the assignment for the rest of the access window. */
export async function bindPersistentVm(assignmentId: string, vmId: string): Promise<void> {
  const supabase = await db();
  await supabase
    .from("lab_assignments")
    .update({
      persistent_vm_id: vmId,
      last_started_at: new Date().toISOString(),
      status: "in_progress",
    } as never)
    .eq("id", assignmentId);
}

export async function markStarted(assignmentId: string): Promise<void> {
  const supabase = await db();
  await supabase
    .from("lab_assignments")
    .update({ last_started_at: new Date().toISOString(), status: "in_progress" } as never)
    .eq("id", assignmentId);
}

/**
 * Charge a finished session against the assignment allowance.
 * Idempotent per session: the caller only invokes it once, at teardown.
 */
export async function chargeUsage(assignmentId: string, billableMinutes: number): Promise<AssignmentAccess | null> {
  if (billableMinutes <= 0) return null;
  const supabase = await db();
  const { data: current } = await supabase
    .from("lab_assignments")
    .select("used_minutes")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!current) return null;
  const { data } = await supabase
    .from("lab_assignments")
    .update({
      used_minutes: (current.used_minutes ?? 0) + billableMinutes,
      last_stopped_at: new Date().toISOString(),
    } as never)
    .eq("id", assignmentId)
    .select(COLUMNS)
    .maybeSingle();
  return data ? mapAssignmentAccess(data as unknown as AssignmentRow) : null;
}

/** True when this machine is dedicated to a still-active persistent grant. */
export async function isPersistentlyBound(vmId: string): Promise<boolean> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("lab_assignments")
      .select("id, status, access_ends_at, remaining_minutes")
      .eq("persistent_vm_id", vmId)
      .limit(5);
    const now = Date.now();
    return (data ?? []).some(
      (row) =>
        row.status !== "revoked" &&
        (!row.access_ends_at || new Date(row.access_ends_at).getTime() > now) &&
        (row.remaining_minutes ?? 0) > 0,
    );
  } catch {
    // Fail safe: never release a machine we could not verify.
    return true;
  }
}

/** Stop the machine and return it to the general pool; clear the binding. */
export async function reclaimPersistentVm(assignmentId: string, vmId: string, actor = "system"): Promise<void> {
  const supabase = await db();
  await supabase.from("lab_assignments").update({ persistent_vm_id: null } as never).eq("id", assignmentId);
  try {
    const { isPoolVmId } = await import("@/lib/vm/pool/registry.server");
    if (isPoolVmId(vmId)) {
      const { stopAndRelease } = await import("@/lib/vm/pool/reaper.server");
      await stopAndRelease(vmId, actor);
    }
  } catch {
    /* the machine is already gone in the provider */
  }
}

/**
 * Admin reset: hand the current machine back so the next launch gets a fresh
 * one from the pool. Used minutes and the access window are left untouched.
 */
export async function resetPersistentAssignment(assignmentId: string, actor = "system"): Promise<boolean> {
  const grant = await loadAssignment(assignmentId);
  if (!grant) return false;
  if (grant.access.persistentVmId) await reclaimPersistentVm(assignmentId, grant.access.persistentVmId, actor);
  return true;
}

/**
 * Sweep grants whose access window has ended and reclaim their machines, so a
 * persistent lab never holds capacity beyond the window an admin granted.
 */
export async function reclaimEndedGrants(actor = "system"): Promise<number> {
  const supabase = await db();
  const { data } = await supabase
    .from("lab_assignments")
    .select("id, persistent_vm_id, access_ends_at, status, remaining_minutes")
    .not("persistent_vm_id", "is", null)
    .limit(200);
  let reclaimed = 0;
  const now = Date.now();
  for (const row of data ?? []) {
    const ended = row.access_ends_at ? new Date(row.access_ends_at).getTime() < now : false;
    const exhausted = (row.remaining_minutes ?? 0) <= 0;
    if (!ended && !exhausted && row.status !== "revoked") continue;
    if (!row.persistent_vm_id) continue;
    await reclaimPersistentVm(row.id, row.persistent_vm_id, `${actor}:access-ended`);
    reclaimed += 1;
  }
  return reclaimed;
}
