/**
 * Atomic VM allocation.
 *
 * The claim is made in Postgres (`app_private.allocate_pool_vm`, which selects
 * one AVAILABLE row `FOR UPDATE SKIP LOCKED` and marks it ALLOCATED in the same
 * statement), so two concurrent START LAB requests can never be handed the same
 * machine — including when they land on different app instances. The in-process
 * lock below only serialises the local cache update.
 */

import { audit, ensurePoolLoaded, getPoolVm, listPoolVms, pool, patchVm } from "./registry.server";
import type { PoolVm } from "./types";

/** How long a claim may sit un-activated before the reaper reclaims it. */
export const ALLOCATION_LEASE_SECONDS = 900;

export class NoCapacityError extends Error {
  readonly templateId: string;
  constructor(message: string, templateId = "") {
    super(message);
    this.name = "NoCapacityError";
    this.templateId = templateId;
  }
}

async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const state = pool();
  const run = state.lock.then(fn, fn);
  // Keep the chain alive regardless of the outcome of this operation.
  state.lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface AllocationRequest {
  templateId: string;
  workspaceId: string;
  labId: string;
  userId: string;
  userName: string;
  sessionId: string | null;
  /** Launch correlation id; recorded on the allocation lease. */
  correlationId?: string;
}

/**
 * Claim exactly one AVAILABLE machine for this learner, or fail with a
 * friendly capacity error. The claim carries a lease: if the launch dies before
 * the session goes ACTIVE, the reaper reclaims the machine.
 */
export async function allocateVm(request: AllocationRequest): Promise<PoolVm> {
  await ensurePoolLoaded();
  const { claimPoolVm } = await import("@/lib/db/vm-pool.repo.server");
  const lockToken = `${request.correlationId ?? "launch"}:${Date.now().toString(36)}`;

  const claimed = await claimPoolVm({
    templateId: request.templateId,
    workspaceId: request.workspaceId || null,
    labId: request.labId || null,
    userId: request.userId,
    userName: request.userName,
    sessionId: request.sessionId,
    lockToken,
    lockSeconds: ALLOCATION_LEASE_SECONDS,
  });

  if (!claimed) throw noCapacity(request.templateId);

  // Mirror the durable claim into the local cache under the process lock.
  const vm = await withLock(() => {
    const cached = getPoolVm(claimed.id);
    if (!cached) {
      pool().vms.set(claimed.id, claimed);
      return claimed;
    }
    Object.assign(cached, claimed);
    return cached;
  });

  await audit("vmpool.allocate", request.userName, vm, `Allocated to ${request.userName} for lab ${request.labId}.`);
  return vm;
}

function noCapacity(templateId: string): NoCapacityError {
  const registered = listPoolVms({ templateId });
  const busy = registered.filter((vm) => vm.status !== "AVAILABLE").length;
  return new NoCapacityError(
    registered.length === 0
      ? "No lab machines are registered for this lab's image yet. Ask your administrator to add capacity to the VM pool."
      : `All ${registered.length} lab machine(s) for this image are busy (${busy} in use). Please try again in a few minutes.`,
    templateId,
  );
}

/** Bind the session id once the session record exists. Idempotent. */
export async function bindSession(vmId: string, sessionId: string): Promise<PoolVm | null> {
  const vm = patchVm(vmId, { currentSessionId: sessionId });
  const { patchPoolVmRow } = await import("@/lib/db/vm-pool.repo.server");
  await patchPoolVmRow(vmId, { current_session_id: sessionId });
  return vm;
}

/** Extend the allocation lease while a launch is still legitimately running. */

/**
 * Detach the finished session but keep the machine assigned to its learner.
 * Used for persistent labs, where the desktop is reserved for the whole access
 * window and must never fall back into the shared pool between sessions.
 */
export async function unbindSession(vmId: string): Promise<PoolVm | null> {
  const vm = patchVm(vmId, { currentSessionId: null, allocationExpiresAt: null });
  const { patchPoolVmRow } = await import("@/lib/db/vm-pool.repo.server");
  await patchPoolVmRow(vmId, { current_session_id: null, allocation_expires_at: null });
  return vm;
}

export async function renewAllocationLease(vmId: string, seconds = ALLOCATION_LEASE_SECONDS): Promise<void> {
  const { patchPoolVmRow } = await import("@/lib/db/vm-pool.repo.server");
  await patchPoolVmRow(vmId, { allocation_expires_at: new Date(Date.now() + seconds * 1000).toISOString() });
}

/** Clear the lease once the session is live; the session now owns the machine. */
export async function clearAllocationLease(vmId: string): Promise<void> {
  const { patchPoolVmRow } = await import("@/lib/db/vm-pool.repo.server");
  await patchPoolVmRow(vmId, { allocation_expires_at: null });
}

/** Return a machine to the pool after teardown. Idempotent. */
export async function releaseVm(vmId: string, actor = "system"): Promise<PoolVm | null> {
  await ensurePoolLoaded();
  const vm = getPoolVm(vmId);
  const { releasePoolVmRow } = await import("@/lib/db/vm-pool.repo.server");
  await releasePoolVmRow(vmId);
  if (!vm) return null;
  const released = await withLock(() => {
    vm.status = "AVAILABLE";
    vm.assignedUserId = null;
    vm.assignedUserName = null;
    vm.labId = null;
    vm.currentSessionId = null;
    vm.orphaned = false;
    vm.allocationLockToken = null;
    vm.allocationExpiresAt = null;
    vm.updatedAt = new Date().toISOString();
    return vm;
  });
  await audit("vmpool.release", actor, released, `Returned ${released.azureVmName} to the pool.`);
  return released;
}

/** Capacity check used before a session is created (durable count). */
export async function availableCapacity(templateId: string, workspaceId?: string | null): Promise<number> {
  const { countAvailable } = await import("@/lib/db/vm-pool.repo.server");
  return countAvailable(templateId, workspaceId ?? null);
}

/** Cache-based count for admin summaries. */
export function availableCount(templateId: string, workspaceId?: string): number {
  return listPoolVms({ templateId }).filter(
    (vm) => vm.status === "AVAILABLE" && !vm.currentSessionId && (!workspaceId || !vm.workspaceId || vm.workspaceId === workspaceId),
  ).length;
}

export function poolHasTemplate(templateId: string): boolean {
  return listPoolVms({ templateId }).length > 0;
}

/** Durable variant: safe on a cold worker where the cache is still empty. */
export async function poolServesTemplate(templateId: string): Promise<boolean> {
  const { countRegistered } = await import("@/lib/db/vm-pool.repo.server");
  return (await countRegistered(templateId)) > 0;
}
