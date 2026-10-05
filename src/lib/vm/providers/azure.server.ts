import type { CloudProvider, CreateVmSpec } from "./provider.server";
import type { VmRecord, VmStatus } from "../types";

/**
 * Mock Azure provider. It simulates the real Azure Compute lifecycle
 * (STOPPED -> STARTING -> BOOTING -> RUNNING -> readiness check -> READY)
 * with wall-clock timings, so it can be swapped for @azure/arm-compute
 * without any change to the orchestrator, API routes or the UI.
 */

const STARTING_MS = 2_500;
const BOOTING_MS = 7_000;
const RUNNING_MS = 9_500;
const READY_MS = 12_000;

interface AzureVmState {
  record: VmRecord;
  /** epoch ms when the current start request was issued */
  startedAtMs: number | null;
}

/** Lazily created — never build state at module scope in the worker runtime. */
let vms: Map<string, AzureVmState> | null = null;
function store() {
  if (!vms) vms = new Map<string, AzureVmState>();
  return vms;
}

function phaseFor(elapsed: number): VmStatus {
  if (elapsed < STARTING_MS) return "STARTING";
  if (elapsed < BOOTING_MS) return "BOOTING";
  if (elapsed < RUNNING_MS) return "RUNNING";
  if (elapsed < READY_MS) return "READINESS_CHECK";
  return "READY";
}

const MESSAGES: Record<VmStatus, string> = {
  STOPPED: "Deallocated in Azure Compute.",
  STARTING: "Azure accepted the start request; allocating compute.",
  BOOTING: "Guest OS booting and applying the lab image.",
  RUNNING: "VM is running; agent heartbeat received.",
  READINESS_CHECK: "Probing remote desktop endpoint and lab agent.",
  READY: "VM is ready for the learner to connect.",
  STOPPING: "Deallocating the VM in Azure Compute.",
  ERROR: "The provider reported a failure for this VM.",
};

function project(state: AzureVmState): VmRecord {
  const { record, startedAtMs } = state;
  if (record.status === "STOPPED" || record.status === "ERROR" || startedAtMs === null) {
    return { ...record, message: MESSAGES[record.status] };
  }
  const status = phaseFor(Date.now() - startedAtMs);
  const ready = status === "READY";
  return {
    ...record,
    status,
    message: MESSAGES[status],
    readiness: {
      checked: status === "READINESS_CHECK" || ready,
      ready,
      detail: ready ? "RDP 3389 reachable, lab agent responding" : "Waiting for guest agent",
    },
  };
}

export class AzureProvider implements CloudProvider {
  readonly name = "Azure" as const;

  async createVM(spec: CreateVmSpec): Promise<VmRecord> {
    const id = `vm-${Math.random().toString(16).slice(2, 10)}`;
    const record: VmRecord = {
      id,
      name: spec.name,
      provider: "Azure",
      region: spec.region,
      size: spec.size,
      image: spec.image,
      status: "STOPPED",
      templateId: spec.templateId,
      workspaceId: spec.workspaceId,
      workspaceName: spec.workspaceName,
      labId: spec.labId,
      labName: spec.labName,
      userId: spec.userId,
      userName: spec.userName,
      sessionId: spec.sessionId,
      startedAt: null,
      expiresAt: null,
      readiness: { checked: false, ready: false, detail: "Not started" },
      message: MESSAGES.STOPPED,
    };
    store().set(id, { record, startedAtMs: null });
    return record;
  }

  async adopt(record: VmRecord): Promise<VmRecord> {
    const startedAtMs = record.startedAt ? Date.parse(record.startedAt) : null;
    const state: AzureVmState = { record: { ...record }, startedAtMs };
    store().set(record.id, state);
    return project(state);
  }

  async startVM(vmId: string, durationMinutes = 60): Promise<VmRecord> {
    const state = store().get(vmId);
    if (!state) throw new Error(`VM ${vmId} not found`);
    const now = Date.now();
    state.startedAtMs = now;
    state.record = {
      ...state.record,
      status: "STARTING",
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationMinutes * 60_000).toISOString(),
      error: null,
    };
    return project(state);
  }

  async stopVM(vmId: string): Promise<VmRecord> {
    const state = store().get(vmId);
    if (!state) throw new Error(`VM ${vmId} not found`);
    state.startedAtMs = null;
    state.record = {
      ...state.record,
      status: "STOPPED",
      startedAt: null,
      expiresAt: null,
      readiness: { checked: false, ready: false, detail: "Not started" },
    };
    return project(state);
  }

  async getVM(vmId: string): Promise<VmRecord | null> {
    const state = store().get(vmId);
    return state ? project(state) : null;
  }

  async getVMStatus(vmId: string): Promise<VmStatus> {
    const vm = await this.getVM(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    return vm.status;
  }

  async checkVMReadiness(vmId: string) {
    const vm = await this.getVM(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    return vm.readiness.ready
      ? { ready: true, detail: "RDP 3389 reachable, lab agent responding" }
      : { ready: false, detail: `Not ready yet (${vm.status})` };
  }

  async deleteVM(vmId: string) {
    return { deleted: store().delete(vmId) };
  }

  /** Mock runtime view shaped exactly like the live provider's. */
  async getVMInstanceView(vmId: string) {
    const vm = await this.getVM(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);
    const running = vm.status === "RUNNING" || vm.status === "READY" || vm.status === "READINESS_CHECK";
    return {
      vmId,
      powerState: running ? "PowerState/running" : vm.status === "STARTING" ? "PowerState/starting" : "PowerState/deallocated",
      provisioningState: vm.status === "ERROR" ? "failed" : "succeeded",
      agentReady: vm.readiness.ready,
      detail: vm.readiness.detail,
      status: vm.status,
      observedAt: new Date().toISOString(),
    };
  }
}