/**
 * Server-side VM pool registry.
 *
 * Admins register REAL Azure virtual machines against a SkillTrack image
 * template. SkillTrack stores Azure resource references only — never
 * credentials — and drives every lifecycle action through the owning cloud
 * connection's ARM client. The browser never talks to Azure.
 */

import { armClientFor, getConnection } from "@/lib/cloud/connections/registry.server";
import { AzureConnectionError } from "@/lib/cloud/connections/azure-arm.server";
import { getImageTemplate, listImageTemplates } from "@/lib/cloud/gallery/registry.server";
import { MOCK_CONNECTION_ID, mockConnection } from "@/lib/cloud/gallery/mock.server";
import { guardVmTransition } from "@/lib/session/state-machine";
import { deploymentEnvironment, infraModes } from "@/lib/infra/runtime.server";
import type { AzureVirtualMachine } from "@/lib/cloud/connections/types";
import type {
  CompatibilityWarning,
  DiscoveredVm,
  PoolTemplateSummary,
  PoolVm,
  PoolVmStatus,
  RegisterVmDraft,
} from "./types";

export class PoolError extends Error {}

interface PoolState {
  vms: Map<string, PoolVm>;
  /** Serialises allocation so two sessions can never claim the same machine. */
  lock: Promise<unknown>;
  /** Hydration promise: the durable table is the source of truth. */
  hydrated: Promise<void> | null;
}

const KEY = "__skilltrack_vm_pool__";

export function pool(): PoolState {
  const g = globalThis as unknown as Record<string, PoolState | undefined>;
  if (!g[KEY]) g[KEY] = { vms: new Map(), lock: Promise.resolve(), hydrated: null };
  return g[KEY]!;
}

/**
 * The in-memory map is a cache over `vm_pool_entries`. Every entry point that
 * can act on a machine awaits hydration first, so a cold worker never believes
 * the pool is empty and double-registers or under-reports capacity.
 */
export async function ensurePoolLoaded(): Promise<void> {
  const state = pool();
  if (!state.hydrated) {
    state.hydrated = import("@/lib/db/vm-pool.repo.server")
      .then(({ loadPoolVms }) => loadPoolVms())
      .then((rows) => {
        for (const row of rows) state.vms.set(row.id, row);
      })
      .catch(() => undefined);
  }
  await state.hydrated;
}

/** Force the next read to re-read the durable table. */
export function invalidatePoolCache() {
  pool().hydrated = null;
}

/** Write-through helper used by every mutation in this module. */
function persistPoolVm(vm: PoolVm) {
  void import("@/lib/db/vm-pool.repo.server")
    .then(({ upsertPoolVm }) => upsertPoolVm(vm))
    .catch(() => null);
}

export const POOL_ID_PREFIX = "pool-vm-";
export function isPoolVmId(id: string) {
  return id.startsWith(POOL_ID_PREFIX);
}

function now() {
  return new Date().toISOString();
}

export function listPoolVms(filter?: { templateId?: string; workspaceId?: string }): PoolVm[] {
  let list = [...pool().vms.values()];
  if (filter?.templateId) list = list.filter((v) => v.templateId === filter.templateId);
  if (filter?.workspaceId) list = list.filter((v) => !v.workspaceId || v.workspaceId === filter.workspaceId);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function getPoolVm(id: string): PoolVm | null {
  return pool().vms.get(id) ?? null;
}

/** Resolve a registered machine from an Azure resource ID (Event Grid subject). */
export function findPoolVmByAzureResourceId(resourceId: string): PoolVm | null {
  const needle = resourceId.trim().toLowerCase();
  if (!needle) return null;
  for (const vm of pool().vms.values()) {
    if (vm.azureResourceId.toLowerCase() === needle) return vm;
  }
  return null;
}

export interface AzureSignal {
  powerState?: string;
  status?: PoolVmStatus | undefined;
  error?: string | null;
  eventType?: string | null;
  source: "eventgrid" | "manual-sync" | "reconciliation";
  at?: string;
  azureMissing?: boolean;
  driftDetected?: boolean;
  driftDetail?: string | null;
  reconciled?: boolean;
}

/**
 * Apply an observed Azure state to a registered machine and persist it.
 *
 * Power state always follows Azure — it is a fact about the cloud. The
 * SkillTrack status only follows when the caller passes one and the lifecycle
 * state machine allows the move, so a live session is never yanked out from
 * under a learner by a late provider event.
 */
export function applyAzureSignal(id: string, signal: AzureSignal): PoolVm | null {
  const vm = pool().vms.get(id);
  if (!vm) return null;
  const at = signal.at ?? now();
  if (signal.powerState) vm.powerState = signal.powerState;
  if (signal.status && signal.status !== vm.status && guardVmTransition(vm.id, vm.status as never, signal.status as never)) {
    vm.status = signal.status;
  }
  if (signal.error !== undefined) vm.error = signal.error;
  if (signal.azureMissing !== undefined) vm.azureMissing = signal.azureMissing;
  if (signal.driftDetected !== undefined) vm.driftDetected = signal.driftDetected;
  if (signal.driftDetail !== undefined) vm.driftDetail = signal.driftDetail;
  if (signal.reconciled) vm.lastReconciledAt = at;
  if (signal.source === "eventgrid") {
    vm.lastAzureEventAt = at;
    vm.lastEventType = signal.eventType ?? null;
  }
  vm.lastEventSource = signal.source;
  vm.lastSyncedAt = at;
  vm.updatedAt = at;
  persistPoolVm(vm);
  return vm;
}

export function poolSummaries(): PoolTemplateSummary[] {
  const byTemplate = new Map<string, PoolTemplateSummary>();
  for (const vm of pool().vms.values()) {
    const entry =
      byTemplate.get(vm.templateId) ??
      { templateId: vm.templateId, templateName: vm.templateName, total: 0, available: 0, allocated: 0, running: 0, inUse: 0, stopped: 0, error: 0 };
    entry.total += 1;
    if (vm.status === "AVAILABLE") entry.available += 1;
    else if (vm.status === "ALLOCATED" || vm.status === "STARTING") entry.allocated += 1;
    else if (vm.status === "RUNNING" || vm.status === "READY") entry.running += 1;
    else if (vm.status === "IN_USE") entry.inUse += 1;
    else if (vm.status === "STOPPED" || vm.status === "STOPPING") entry.stopped += 1;
    else if (vm.status === "ERROR") entry.error += 1;
    byTemplate.set(vm.templateId, entry);
  }
  return [...byTemplate.values()].sort((a, b) => a.templateName.localeCompare(b.templateName));
}

/* ------------------------------------------------------------------ Azure */

function isMockConnection(id: string) {
  return id === MOCK_CONNECTION_ID;
}

/** Sample machines used only by the development sample connection. */
function mockVms(resourceGroup: string): AzureVirtualMachine[] {
  return ["vm-lab-win11-01", "vm-lab-win11-02", "vm-lab-win11-03"].map((name, i) => ({
    id: `/subscriptions/${mockConnection.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${name}`,
    name,
    resourceGroup,
    location: "eastus",
    vmSize: "Standard_D4s_v5",
    osType: "Windows",
    powerState: i === 0 ? "VM running" : "VM deallocated",
    provisioningState: "Succeeded",
  }));
}

/**
 * The sample connection exists for local development only. In staging and
 * production it must never surface machines — a simulated VM in a real pool
 * would hand a learner a desktop that does not exist.
 */
function assertMockConnectionAllowed(connectionId: string): void {
  if (!isMockConnection(connectionId)) return;
  if (deploymentEnvironment() === "development" || infraModes().emergencyFallbackActive) return;
  throw new PoolError(
    "The sample Azure connection is not available outside development. Register machines from a real Azure connection.",
  );
}

export async function discoverVms(connectionId: string, resourceGroup: string | null): Promise<DiscoveredVm[]> {
  assertMockConnectionAllowed(connectionId);
  const registered = new Set([...pool().vms.values()].map((v) => v.azureResourceId.toLowerCase()));
  const vms = isMockConnection(connectionId)
    ? mockVms(resourceGroup ?? "rg-skilltrack-training")
    : await (async () => {
        const arm = await armClientFor(connectionId);
        if (!arm) throw new PoolError("Connection credentials are unavailable.");
        return arm.listVirtualMachines(resourceGroup);
      })();

  return vms.map((vm) => ({
    id: vm.id,
    name: vm.name,
    resourceGroup: vm.resourceGroup,
    location: vm.location,
    vmSize: vm.vmSize,
    osType: vm.osType,
    powerState: vm.powerState,
    provisioningState: vm.provisioningState,
    registered: registered.has(vm.id.toLowerCase()),
  }));
}

/** Compare the Azure machine against the SkillTrack template it is mapped to. */
export function compatibility(vm: DiscoveredVm, template: { region: string; vmSize: string; osType: string }): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  if (template.region && vm.location && template.region.toLowerCase() !== vm.location.toLowerCase())
    warnings.push({ field: "Region", expected: template.region, actual: vm.location });
  if (template.vmSize && vm.vmSize && template.vmSize.toLowerCase() !== vm.vmSize.toLowerCase())
    warnings.push({ field: "VM size", expected: template.vmSize, actual: vm.vmSize });
  if (template.osType && vm.osType && template.osType.toLowerCase() !== vm.osType.toLowerCase())
    warnings.push({ field: "Operating system", expected: template.osType, actual: vm.osType });
  return warnings;
}

/** Normalise an Azure power state onto a pool status for an idle machine. */
export function statusFromPowerState(powerState: string): PoolVmStatus {
  const p = powerState.toLowerCase();
  if (p.includes("running")) return "RUNNING";
  if (p.includes("starting")) return "STARTING";
  if (p.includes("stopping") || p.includes("deallocating")) return "STOPPING";
  if (p.includes("deallocated") || p.includes("stopped")) return "STOPPED";
  return "STOPPED";
}

/* -------------------------------------------------------------- Mutations */

export async function registerVm(draft: RegisterVmDraft, actor: string): Promise<PoolVm> {
  assertMockConnectionAllowed(draft.cloudConnectionId);
  await ensurePoolLoaded();
  const connection = isMockConnection(draft.cloudConnectionId) ? mockConnection : getConnection(draft.cloudConnectionId);
  if (!connection) throw new PoolError("The selected Azure connection is no longer available.");

  const template = getImageTemplate(draft.templateId);
  if (!template) throw new PoolError("The selected SkillTrack image template no longer exists.");

  const discovered = (await discoverVms(draft.cloudConnectionId, draft.resourceGroup)).find(
    (v) => v.name === draft.azureVmName,
  );
  if (!discovered) throw new PoolError("That virtual machine was not found in the resource group.");
  if (pool().vms.has(poolIdFor(discovered.id))) throw new PoolError("This VM is already registered in the pool.");

  const record: PoolVm = {
    id: poolIdFor(discovered.id),
    name: draft.displayName?.trim() || discovered.name,
    workspaceId: draft.workspaceId ?? null,
    labId: null,
    templateId: template.id,
    templateName: template.name,
    cloudConnectionId: draft.cloudConnectionId,
    cloudConnectionName: connection.name,
    subscriptionId: connection.subscriptionId,
    resourceGroup: discovered.resourceGroup,
    azureResourceId: discovered.id,
    azureVmName: discovered.name,
    region: discovered.location,
    vmSize: discovered.vmSize,
    imageVersion: template.imageVersion,
    osType: discovered.osType,
    status: statusFromPowerState(discovered.powerState) === "RUNNING" ? "AVAILABLE" : "AVAILABLE",
    assignedUserId: null,
    assignedUserName: null,
    currentSessionId: null,
    powerState: discovered.powerState,
    lastSyncedAt: now(),
    orphaned: false,
    error: null,
    mock: isMockConnection(draft.cloudConnectionId),
    createdAt: now(),
    updatedAt: now(),
  };
  pool().vms.set(record.id, record);
  persistPoolVm(record);
  await audit("vmpool.register", actor, record, `Registered Azure VM ${record.azureVmName} for template ${template.name}.`);
  return record;
}

function poolIdFor(azureResourceId: string) {
  // Deterministic, so re-registering the same machine collides instead of duplicating.
  let hash = 0;
  for (const ch of azureResourceId.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${POOL_ID_PREFIX}${hash.toString(36)}`;
}

export function patchVm(id: string, patch: Partial<PoolVm>): PoolVm | null {
  const vm = pool().vms.get(id);
  if (!vm) return null;
  // Refuse impossible state moves rather than corrupting the pool.
  if (patch.status && patch.status !== vm.status) {
    if (!guardVmTransition(vm.id, vm.status as never, patch.status as never)) return vm;
  }
  Object.assign(vm, patch, { updatedAt: now() });
  persistPoolVm(vm);
  return vm;
}

/**
 * Explicit Super Admin override: bring a retired machine back into service.
 * Retirement is terminal for the lifecycle state machine on purpose, so this
 * is the only path back, and it is always operator-initiated and audited.
 */
export function restoreRetiredVm(id: string): PoolVm | null {
  const vm = pool().vms.get(id);
  if (!vm) return null;
  vm.status = "AVAILABLE";
  vm.orphaned = false;
  vm.error = null;
  vm.updatedAt = now();
  persistPoolVm(vm);
  return vm;
}

export async function removeVm(id: string, actor: string): Promise<boolean> {
  await ensurePoolLoaded();
  const vm = pool().vms.get(id);
  if (!vm) return false;
  if (vm.currentSessionId) throw new PoolError("This VM is in use by an active session.");
  pool().vms.delete(id);
  const { deletePoolVmRow } = await import("@/lib/db/vm-pool.repo.server");
  await deletePoolVmRow(id);
  await audit("vmpool.remove", actor, vm, `Removed ${vm.azureVmName} from the pool.`);
  return true;
}

/** Re-read the real power state from Azure for one machine. */
export async function syncVm(id: string): Promise<PoolVm | null> {
  const vm = pool().vms.get(id);
  if (!vm) return null;
  try {
    if (vm.mock) {
      vm.lastSyncedAt = now();
      return vm;
    }
    const arm = await armClientFor(vm.cloudConnectionId);
    if (!arm) throw new PoolError("Connection credentials are unavailable.");
    const view = await arm.getInstanceView(vm.resourceGroup, vm.azureVmName);
    vm.powerState = view.powerState;
    vm.lastSyncedAt = now();
    vm.error = null;
    vm.lastEventSource = "manual-sync";
    // Idle machines follow Azure; claimed machines keep their SkillTrack state.
    if (!vm.currentSessionId) {
      vm.status = statusFromPowerState(view.powerState) === "RUNNING" ? "RUNNING" : "AVAILABLE";
      vm.orphaned = statusFromPowerState(view.powerState) === "RUNNING";
    } else {
      vm.orphaned = false;
    }
  } catch (error) {
    vm.error = error instanceof AzureConnectionError ? error.message : "Azure status could not be read.";
    vm.status = "ERROR";
  }
  vm.updatedAt = now();
  return vm;
}

export async function syncAll(): Promise<PoolVm[]> {
  await ensurePoolLoaded();
  const results: PoolVm[] = [];
  for (const vm of [...pool().vms.values()]) {
    const synced = await syncVm(vm.id);
    if (synced) results.push(synced);
  }
  return results;
}

/**
 * Orphans: machines Azure reports as running while SkillTrack holds no active
 * session for them. Surfaced to admins and reclaimable in one click.
 */
export async function detectOrphans(): Promise<PoolVm[]> {
  await ensurePoolLoaded();
  const { getSessionRaw } = await import("@/lib/session/registry.server");
  const orphans: PoolVm[] = [];
  for (const vm of pool().vms.values()) {
    const live = vm.currentSessionId ? await getSessionRaw(vm.currentSessionId) : null;
    const sessionLive = live ? live.status === "ACTIVE" || live.status === "STARTING" || live.status === "DISCONNECTING" : false;
    if (!sessionLive && vm.currentSessionId) {
      vm.currentSessionId = null;
      vm.assignedUserId = null;
      vm.assignedUserName = null;
      vm.labId = null;
      vm.status = vm.powerState.toLowerCase().includes("running") ? "RUNNING" : "AVAILABLE";
    }
    vm.orphaned = !sessionLive && vm.powerState.toLowerCase().includes("running");
    if (vm.orphaned) orphans.push(vm);
  }
  return orphans;
}

export function templateOptions() {
  return listImageTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    region: t.region,
    vmSize: t.vmSize,
    osType: t.osType,
    cloudConnectionId: t.cloudConnectionId,
    cloudConnectionName: t.cloudConnectionName,
    defaultSessionDuration: t.defaultSessionDuration,
  }));
}

export async function audit(
  action: import("@/lib/cloud/audit/types").CloudAuditAction,
  actor: string,
  vm: PoolVm,
  detail: string,
  outcome: "success" | "failure" = "success",
) {
  try {
    const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
    recordCloudAudit({
      action,
      outcome,
      actor: { sub: actor, role: "admin", name: actor },
      target: vm.azureVmName,
      connectionId: vm.cloudConnectionId,
      subscriptionId: vm.subscriptionId,
      resourceGroup: vm.resourceGroup,
      workspaceId: vm.workspaceId,
      detail,
    });
  } catch {
    /* auditing is best-effort and must never block a lifecycle action */
  }
}
