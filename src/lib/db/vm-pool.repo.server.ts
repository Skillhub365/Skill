import { db } from "./client.server";
import type { PoolVm, PoolVmStatus } from "@/lib/vm/pool/types";

/**
 * Durable VM pool storage (Phase 5).
 *
 * The pool is the production allocation path, so it cannot live in worker
 * memory: a restart would forget which learner owns which Azure machine and
 * leak compute. Every registered machine is a row in `vm_pool_entries`, and
 * allocation runs through a SECURITY DEFINER function that claims exactly one
 * row with `FOR UPDATE SKIP LOCKED`, so two simultaneous launches can never be
 * handed the same VM — even on different app instances.
 */

interface PoolRow {
  id: string;
  tenant_id: string | null;
  name: string;
  template_id: string;
  template_name: string;
  workspace_id: string | null;
  lab_id: string | null;
  cloud_connection_id: string;
  cloud_connection_name: string;
  subscription_id: string;
  resource_group: string;
  azure_resource_id: string;
  azure_vm_name: string;
  region: string;
  vm_size: string;
  image_version: string | null;
  os_type: string;
  status: string;
  power_state: string;
  private_ip: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  current_session_id: string | null;
  allocation_lock_token: string | null;
  allocation_expires_at: string | null;
  orphaned: boolean;
  last_error: string | null;
  last_synced_at: string | null;
  mock: boolean;
  created_at: string;
  updated_at: string;
}

interface EventColumns {
  last_azure_event_at?: string | null;
  last_event_type?: string | null;
  last_event_source?: string | null;
  drift_detected?: boolean | null;
  drift_detail?: string | null;
  azure_missing?: boolean | null;
  last_reconciled_at?: string | null;
}

export function rowToPoolVm(row: PoolRow): PoolVm {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    labId: row.lab_id,
    templateId: row.template_id,
    templateName: row.template_name,
    cloudConnectionId: row.cloud_connection_id,
    cloudConnectionName: row.cloud_connection_name,
    subscriptionId: row.subscription_id,
    resourceGroup: row.resource_group,
    azureResourceId: row.azure_resource_id,
    azureVmName: row.azure_vm_name,
    region: row.region,
    vmSize: row.vm_size,
    imageVersion: row.image_version ?? "",
    osType: row.os_type,
    status: row.status as PoolVmStatus,
    assignedUserId: row.assigned_user_id,
    assignedUserName: row.assigned_user_name,
    currentSessionId: row.current_session_id,
    powerState: row.power_state,
    lastSyncedAt: row.last_synced_at,
    orphaned: row.orphaned,
    error: row.last_error,
    mock: row.mock,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    allocationExpiresAt: row.allocation_expires_at,
    allocationLockToken: row.allocation_lock_token,
    privateIp: row.private_ip,
    lastAzureEventAt: (row as PoolRow & EventColumns).last_azure_event_at ?? null,
    lastEventType: (row as PoolRow & EventColumns).last_event_type ?? null,
    lastEventSource: (row as PoolRow & EventColumns).last_event_source ?? null,
    driftDetected: (row as PoolRow & EventColumns).drift_detected ?? false,
    driftDetail: (row as PoolRow & EventColumns).drift_detail ?? null,
    azureMissing: (row as PoolRow & EventColumns).azure_missing ?? false,
    lastReconciledAt: (row as PoolRow & EventColumns).last_reconciled_at ?? null,
  };
}

function poolVmToRow(vm: PoolVm, tenantId: string | null) {
  return {
    id: vm.id,
    tenant_id: tenantId,
    name: vm.name,
    template_id: vm.templateId,
    template_name: vm.templateName,
    workspace_id: vm.workspaceId,
    lab_id: vm.labId,
    cloud_connection_id: vm.cloudConnectionId,
    cloud_connection_name: vm.cloudConnectionName,
    subscription_id: vm.subscriptionId,
    resource_group: vm.resourceGroup,
    azure_resource_id: vm.azureResourceId,
    azure_vm_name: vm.azureVmName,
    region: vm.region,
    vm_size: vm.vmSize,
    image_version: vm.imageVersion || null,
    os_type: vm.osType,
    status: vm.status,
    power_state: vm.powerState,
    assigned_user_id: vm.assignedUserId,
    assigned_user_name: vm.assignedUserName,
    current_session_id: vm.currentSessionId,
    allocation_lock_token: vm.allocationLockToken ?? null,
    allocation_expires_at: vm.allocationExpiresAt ?? null,
    orphaned: vm.orphaned,
    last_error: vm.error,
    last_synced_at: vm.lastSyncedAt,
    private_ip: vm.privateIp ?? null,
    mock: vm.mock,
    last_azure_event_at: vm.lastAzureEventAt ?? null,
    last_event_type: vm.lastEventType ?? null,
    last_event_source: vm.lastEventSource ?? null,
    drift_detected: vm.driftDetected ?? false,
    drift_detail: vm.driftDetail ?? null,
    azure_missing: vm.azureMissing ?? false,
    last_reconciled_at: vm.lastReconciledAt ?? null,
  };
}

/** Load the whole pool (small, admin-scale data). */
export async function loadPoolVms(): Promise<PoolVm[]> {
  try {
    const supabase = await db();
    const { data } = await supabase.from("vm_pool_entries").select("*").limit(1000);
    return (data ?? []).map((row) => rowToPoolVm(row as unknown as PoolRow));
  } catch {
    return [];
  }
}

export async function upsertPoolVm(vm: PoolVm, tenantId: string | null = null): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("vm_pool_entries").upsert(poolVmToRow(vm, tenantId) as never, { onConflict: "id" });
  } catch (error) {
    console.error("[vm-pool] persist failed", (error as Error)?.message);
  }
}

export async function patchPoolVmRow(id: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const supabase = await db();
    await supabase
      .from("vm_pool_entries")
      .update({ ...patch, updated_at: new Date().toISOString() } as never)
      .eq("id", id);
  } catch (error) {
    console.error("[vm-pool] update failed", (error as Error)?.message);
  }
}

export async function deletePoolVmRow(id: string): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("vm_pool_entries").delete().eq("id", id);
  } catch {
    /* removal is best-effort; the row is re-synced on the next load */
  }
}

export interface ClaimInput {
  templateId: string;
  workspaceId: string | null;
  labId: string | null;
  userId: string;
  userName: string;
  sessionId: string | null;
  lockToken: string;
  lockSeconds?: number;
}

/**
 * Atomic claim. Returns null when no machine is free — the caller turns that
 * into a friendly no-capacity error rather than provisioning something new.
 */
export async function claimPoolVm(input: ClaimInput): Promise<PoolVm | null> {
  const supabase = await db();
  const { data, error } = await supabase.rpc("allocate_pool_vm" as never, {
    p_template_id: input.templateId,
    p_workspace_id: input.workspaceId,
    p_lab_id: input.labId,
    p_user_id: input.userId,
    p_user_name: input.userName,
    p_session_id: input.sessionId,
    p_lock_token: input.lockToken,
    p_lock_seconds: input.lockSeconds ?? 900,
  } as never);
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as unknown as PoolRow | null;
  return row && row.id ? rowToPoolVm(row) : null;
}

/** Return a machine to the pool. Idempotent. */
export async function releasePoolVmRow(id: string, status: PoolVmStatus = "AVAILABLE"): Promise<void> {
  await patchPoolVmRow(id, {
    status,
    assigned_user_id: null,
    assigned_user_name: null,
    lab_id: null,
    current_session_id: null,
    allocation_lock_token: null,
    allocation_expires_at: null,
    orphaned: false,
  });
}

/**
 * Allocations whose lock elapsed without the session reaching ACTIVE. The
 * reaper stops the machine and returns it to the pool.
 */
export async function listStaleAllocations(): Promise<PoolVm[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("vm_pool_entries")
      .select("*")
      .not("allocation_expires_at", "is", null)
      .lt("allocation_expires_at", new Date().toISOString())
      .limit(200);
    return (data ?? []).map((row) => rowToPoolVm(row as unknown as PoolRow));
  } catch {
    return [];
  }
}

/** Free machines for a template — the pre-flight capacity check. */
export async function countAvailable(templateId: string, workspaceId?: string | null): Promise<number> {
  try {
    const supabase = await db();
    let query = supabase
      .from("vm_pool_entries")
      .select("id", { count: "exact", head: true })
      .eq("template_id", templateId)
      .eq("status", "AVAILABLE")
      .is("current_session_id", null);
    if (workspaceId) query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    const { count } = await query;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function countRegistered(templateId: string): Promise<number> {
  try {
    const supabase = await db();
    const { count } = await supabase
      .from("vm_pool_entries")
      .select("id", { count: "exact", head: true })
      .eq("template_id", templateId);
    return count ?? 0;
  } catch {
    return 0;
  }
}