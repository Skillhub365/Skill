/**
 * Pool-backed cloud provider.
 *
 * Implements the same CloudProvider contract as the mock and live Azure
 * providers, but instead of creating machines it CLAIMS a pre-created Azure VM
 * from the SkillTrack pool and drives it through the real ARM API using the
 * credentials of the cloud connection that owns it.
 *
 *   START LAB -> allocate (atomic) -> ARM start -> boot -> readiness -> READY
 */

import { armClientFor } from "@/lib/cloud/connections/registry.server";
import { AzureError } from "@/lib/cloud/azure-errors";
import { rememberPrivateIp, forgetPrivateIp } from "../private-endpoints.server";
import type { CloudProvider, CreateVmSpec, VmInstanceView } from "../providers/provider.server";
import type { VmRecord, VmStatus } from "../types";
import { allocateVm, releaseVm, NoCapacityError } from "./allocator.server";
import { audit, getPoolVm, isPoolVmId, patchVm, statusFromPowerState } from "./registry.server";
import type { PoolVm } from "./types";

export { NoCapacityError, isPoolVmId };

const API_NETWORK = "2023-11-01";

interface Runtime {
  record: VmRecord;
  startedAtMs: number;
}

const KEY = "__skilltrack_pool_runtime__";
function runtimes(): Map<string, Runtime> {
  const g = globalThis as unknown as Record<string, Map<string, Runtime> | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

function baseRecord(vm: PoolVm, spec: CreateVmSpec): VmRecord {
  return {
    id: vm.id,
    name: vm.name,
    provider: "Azure",
    region: vm.region,
    size: vm.vmSize,
    image: vm.imageVersion,
    status: "STOPPED",
    templateId: vm.templateId,
    workspaceId: spec.workspaceId,
    workspaceName: spec.workspaceName,
    labId: spec.labId,
    labName: spec.labName,
    userId: spec.userId,
    userName: spec.userName,
    sessionId: spec.sessionId,
    startedAt: null,
    expiresAt: spec.durationMinutes ? new Date(Date.now() + spec.durationMinutes * 60_000).toISOString() : null,
    readiness: { checked: false, ready: false, detail: "Machine allocated from the lab pool." },
    message: "Lab machine allocated.",
    error: null,
  };
}

/** Mock connections never touch Azure; their state machine is time-based. */
function mockAdvance(vm: PoolVm, runtime: Runtime): VmStatus {
  const elapsed = Date.now() - runtime.startedAtMs;
  if (runtime.record.status === "STOPPED" || runtime.record.status === "STOPPING") return runtime.record.status;
  if (elapsed < 4_000) return "STARTING";
  if (elapsed < 9_000) return "BOOTING";
  if (elapsed < 13_000) return "READINESS_CHECK";
  return "READY";
}

async function armFor(vm: PoolVm) {
  const arm = await armClientFor(vm.cloudConnectionId);
  if (!arm) throw new AzureError("AZURE_NOT_CONFIGURED", "cloud connection credentials unavailable");
  return arm;
}

/** Private NIC address for the RDP broker; never returned to the browser. */
export async function resolvePrivateIp(vm: PoolVm): Promise<string | null> {
  try {
    const arm = await armFor(vm);
    interface Nic {
      properties?: {
        virtualMachine?: { id?: string };
        ipConfigurations?: Array<{ properties?: { privateIPAddress?: string } }>;
      };
    }
    const nics = await arm.list<Nic>(
      `/subscriptions/${vm.subscriptionId}/resourceGroups/${encodeURIComponent(vm.resourceGroup)}/providers/Microsoft.Network/networkInterfaces`,
      API_NETWORK,
    );
    const nic = nics.find((n) => n.properties?.virtualMachine?.id?.toLowerCase() === vm.azureResourceId.toLowerCase());
    return nic?.properties?.ipConfigurations?.[0]?.properties?.privateIPAddress ?? null;
  } catch (error) {
    console.error("Private IP lookup failed for pooled VM:", error);
    return null;
  }
}

export class PoolProvider implements CloudProvider {
  readonly name = "Azure" as const;

  private vm(vmId: string): PoolVm {
    const vm = getPoolVm(vmId);
    if (!vm) throw new AzureError("AZURE_VM_NOT_FOUND", vmId);
    return vm;
  }

  private runtime(vmId: string): Runtime {
    const runtime = runtimes().get(vmId);
    if (!runtime) throw new AzureError("AZURE_VM_NOT_FOUND", vmId);
    return runtime;
  }

  /** "Create" means: atomically claim a pre-created machine for this learner. */
  async createVM(spec: CreateVmSpec): Promise<VmRecord> {
    const vm = await allocateVm({
      templateId: spec.templateId,
      workspaceId: spec.workspaceId,
      labId: spec.labId,
      userId: spec.userId,
      userName: spec.userName,
      sessionId: spec.sessionId,
    });
    const record = baseRecord(vm, spec);
    runtimes().set(vm.id, { record, startedAtMs: Date.now() });
    return record;
  }

  async startVM(vmId: string): Promise<VmRecord> {
    const vm = this.vm(vmId);
    const runtime = this.runtime(vmId);
    patchVm(vm.id, { status: "STARTING" });
    runtime.startedAtMs = Date.now();
    runtime.record.status = "STARTING";
    runtime.record.startedAt = new Date().toISOString();
    runtime.record.message = "Starting the Azure virtual machine.";
    if (!vm.mock) {
      const arm = await armFor(vm);
      await arm.startVirtualMachine(vm.resourceGroup, vm.azureVmName);
    }
    await audit("vm.start", vm.assignedUserName ?? "system", vm, `Start requested for ${vm.azureVmName}.`);
    return runtime.record;
  }

  async stopVM(vmId: string): Promise<VmRecord> {
    const vm = this.vm(vmId);
    const runtime = runtimes().get(vmId);
    patchVm(vm.id, { status: "STOPPING" });
    if (runtime) {
      runtime.record.status = "STOPPING";
      runtime.record.message = "Deallocating the Azure virtual machine.";
    }
    if (!vm.mock) {
      const arm = await armFor(vm);
      await arm.deallocateVirtualMachine(vm.resourceGroup, vm.azureVmName);
    }
    forgetPrivateIp(vm.id);
    await audit("vm.deallocate", vm.assignedUserName ?? "system", vm, `Deallocated ${vm.azureVmName}.`);
    // Ordered release: gateway + VM are already torn down by the caller.
    await releaseVm(vm.id, vm.assignedUserName ?? "system");
    patchVm(vm.id, { status: "AVAILABLE", powerState: "VM deallocated" });
    if (runtime) {
      runtime.record.status = "STOPPED";
      runtime.record.message = "Lab machine returned to the pool.";
      return runtime.record;
    }
    return baseRecordFallback(vm);
  }

  async getVMStatus(vmId: string): Promise<VmStatus> {
    return (await this.getVMInstanceView(vmId)).status;
  }

  async getVM(vmId: string): Promise<VmRecord | null> {
    return runtimes().get(vmId)?.record ?? null;
  }

  async checkVMReadiness(vmId: string): Promise<{ ready: boolean; detail: string }> {
    const view = await this.getVMInstanceView(vmId);
    return { ready: view.status === "READY", detail: view.detail };
  }

  async getVMInstanceView(vmId: string): Promise<VmInstanceView> {
    const vm = this.vm(vmId);
    const runtime = this.runtime(vmId);

    if (vm.mock) {
      const status = mockAdvance(vm, runtime);
      this.applyStatus(vm, runtime, status, status === "READY" ? "Guest agent responding." : "Machine is booting.");
      return {
        vmId,
        powerState: status === "STOPPED" ? "VM deallocated" : "VM running",
        provisioningState: "Succeeded",
        agentReady: status === "READY",
        detail: runtime.record.readiness.detail,
        status,
        observedAt: new Date().toISOString(),
      };
    }

    const arm = await armFor(vm);
    const view = await arm.getInstanceView(vm.resourceGroup, vm.azureVmName);
    const power = statusFromPowerState(view.powerState);
    let status: VmStatus;
    if (view.provisioningState.toLowerCase() === "failed") status = "ERROR";
    else if (power === "RUNNING") status = view.agentReady ? "READY" : "BOOTING";
    else if (power === "STARTING") status = "STARTING";
    else if (power === "STOPPING") status = "STOPPING";
    else status = "STOPPED";

    const detail = view.agentReady
      ? "Azure guest agent is responding; the desktop is ready."
      : `Azure reports the machine as ${view.powerState.toLowerCase()}.`;
    this.applyStatus(vm, runtime, status, detail);
    patchVm(vm.id, { powerState: view.powerState, lastSyncedAt: new Date().toISOString() });

    if (status === "READY" && !runtime.record.readiness.ready) {
      const ip = await resolvePrivateIp(vm);
      if (ip) rememberPrivateIp(vm.id, ip);
    }

    return {
      vmId,
      powerState: view.powerState,
      provisioningState: view.provisioningState,
      agentReady: view.agentReady,
      detail,
      status,
      observedAt: new Date().toISOString(),
    };
  }

  private applyStatus(vm: PoolVm, runtime: Runtime, status: VmStatus, detail: string) {
    runtime.record.status = status;
    runtime.record.readiness = { checked: true, ready: status === "READY", detail };
    runtime.record.message = detail;
    if (status === "READY") patchVm(vm.id, { status: "IN_USE" });
    else if (status === "ERROR") patchVm(vm.id, { status: "ERROR", error: detail });
    else if (status === "RUNNING" || status === "BOOTING" || status === "READINESS_CHECK")
      patchVm(vm.id, { status: "RUNNING" });
  }

  /** Pooled machines are never deleted by SkillTrack — only released. */
  async deleteVM(vmId: string): Promise<{ deleted: boolean }> {
    await this.stopVM(vmId).catch(() => null);
    runtimes().delete(vmId);
    return { deleted: false };
  }

  async adopt(record: VmRecord): Promise<VmRecord> {
    const existing = runtimes().get(record.id);
    if (existing) return existing.record;
    runtimes().set(record.id, { record, startedAtMs: Date.now() });
    return record;
  }
}

function baseRecordFallback(vm: PoolVm): VmRecord {
  return {
    id: vm.id,
    name: vm.name,
    provider: "Azure",
    region: vm.region,
    size: vm.vmSize,
    image: vm.imageVersion,
    status: "STOPPED",
    templateId: vm.templateId,
    workspaceId: vm.workspaceId ?? "",
    workspaceName: "",
    labId: vm.labId ?? "",
    labName: "",
    userId: vm.assignedUserId ?? "",
    userName: vm.assignedUserName ?? "",
    sessionId: vm.currentSessionId,
    startedAt: null,
    expiresAt: null,
    readiness: { checked: true, ready: false, detail: "Machine returned to the pool." },
    message: "Machine returned to the pool.",
    error: null,
  };
}

let instance: PoolProvider | null = null;
export function poolProvider(): PoolProvider {
  if (!instance) instance = new PoolProvider();
  return instance;
}

/**
 * Dynamic provisioning (create a brand new VM from a gallery image) is
 * scaffolded but disabled: ENABLE_DYNAMIC_VM_PROVISIONING=false.
 */
export function dynamicProvisioningEnabled(): boolean {
  return (process.env["ENABLE_DYNAMIC_VM_PROVISIONING"] ?? "false").toLowerCase() === "true";
}

export async function provisionVMFromTemplate(_spec: CreateVmSpec): Promise<VmRecord> {
  if (!dynamicProvisioningEnabled()) {
    throw new AzureError(
      "AZURE_NOT_CONFIGURED",
      "Dynamic VM provisioning is disabled; register machines in the VM pool instead.",
    );
  }
  // Implementation lands with Phase 8: gallery image -> NIC -> VM -> pool record.
  throw new AzureError("AZURE_NOT_CONFIGURED", "Dynamic provisioning is not implemented yet.");
}
