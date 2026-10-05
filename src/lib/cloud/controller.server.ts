import { orchestrator } from "@/lib/vm/orchestrator.server";
import { publishLifecycle, lastPhase } from "@/lib/realtime/bus.server";
import { mappingFor, redactMapping, rememberMapping, forgetMapping } from "./mapping.server";
import type { CreateVmSpec } from "@/lib/vm/providers/provider.server";
import type { VmInstanceView } from "@/lib/vm/providers/provider.server";
import type { CloudProviderName, VmRecord, VmStatus } from "@/lib/vm/types";
import type { LifecyclePhase, VmDetails } from "./types";

/**
 * Cloud Controller — the single server-side entry point between the SkillTrack
 * API and any cloud provider.
 *
 *   API route -> CloudController -> CloudProvider (Azure | AWS | GCP)
 *                                -> Azure Resource Manager -> Azure VM
 *
 * Responsibilities beyond the raw provider calls:
 *  - record the SkillTrack -> Azure resource mapping for each machine
 *  - publish lifecycle events so the browser is pushed updates over SSE
 *  - drive backend polling of the provider (the browser never polls Azure)
 *
 * The frontend has no knowledge of which provider is in use.
 */

/** Provider status -> browser-facing lifecycle phase. */
export function phaseFor(status: VmStatus): LifecyclePhase {
  switch (status) {
    case "STARTING":
      return "STARTING";
    case "BOOTING":
      return "BOOTING";
    case "RUNNING":
      return "RUNNING";
    case "READINESS_CHECK":
      return "CHECKING";
    case "READY":
      return "READY";
    case "STOPPING":
      return "STOPPING";
    case "ERROR":
      return "ERROR";
    default:
      return "STOPPED";
  }
}

async function emit(sessionId: string | null, vm: VmRecord, source: "controller" | "poller" = "controller") {
  if (!sessionId) return;
  const phase = phaseFor(vm.status);
  // Deduplicated against the durable log, so a repeated poll on any instance
  // does not re-push a phase the learner has already seen.
  if ((await lastPhase(sessionId)) === phase) return;
  await publishLifecycle({ sessionId, vmId: vm.id, phase, message: vm.error ?? vm.message, source });
}

/** Machines the controller is already watching, so a repeat start is a no-op. */
let watching: Set<string> | null = null;
function watchSet() {
  if (!watching) watching = new Set<string>();
  return watching;
}

const POLL_INTERVAL_MS = 1500;
/** Configurable readiness budget; falls back to ten minutes. */
async function watchTimeoutMs(): Promise<number> {
  try {
    const { infraModes } = await import("@/lib/infra/runtime.server");
    return infraModes().readinessTimeoutMs;
  } catch {
    return 10 * 60_000;
  }
}

/**
 * A machine that never becomes ready must not silently burn the learner's time
 * or leave compute running: release the connection, deallocate, mark the
 * session ERROR and record the audit event.
 */
async function abandon(sessionId: string, vmId: string, message: string) {
  try {
    const { failSession } = await import("@/lib/session/registry.server");
    const failed = await failSession(sessionId, message);
    if (failed) return;
  } catch {
    /* fall through to a bare stop below */
  }
  try {
    await orchestrator.stopVM(vmId);
  } catch {
    /* the provider may have already released it */
  }
  await publishLifecycle({ sessionId, vmId, phase: "ERROR", message, source: "poller" });
}

/**
 * Backend poll loop. Azure is polled here — never from the browser — and each
 * observed transition is pushed to the session's SSE stream. When Azure Event
 * Grid is wired up it publishes into the same bus and this loop becomes a
 * fallback rather than the primary signal.
 */
function watch(vmId: string, sessionId: string, provider: CloudProviderName) {
  const key = `${sessionId}:${vmId}`;
  if (watchSet().has(key)) return;
  watchSet().add(key);
  const startedAt = Date.now();

  const tick = async () => {
    try {
      const budget = await watchTimeoutMs();
      const vm = await orchestrator.getVM(vmId, provider);
      if (!vm) {
        watchSet().delete(key);
        await abandon(sessionId, vmId, "This lab machine is no longer available. Please start the lab again.");
        return;
      }
      await emit(sessionId, vm, "poller");
      if (vm.status === "ERROR") {
        watchSet().delete(key);
        await abandon(sessionId, vmId, "The lab machine reported a failure and was released. Please start the lab again.");
        return;
      }
      const settled = vm.status === "READY" || vm.status === "STOPPED";
      if (settled) {
        watchSet().delete(key);
        return;
      }
      if (Date.now() - startedAt > budget) {
        watchSet().delete(key);
        await abandon(sessionId, vmId, "The machine did not become ready in time and was released. Please start the lab again.");
        return;
      }
      setTimeout(() => void tick(), POLL_INTERVAL_MS);
    } catch {
      watchSet().delete(key);
      await publishLifecycle({
        sessionId,
        vmId,
        phase: "ERROR",
        message: "We lost contact with the cloud provider while starting your machine.",
        source: "poller",
      });
    }
  };
  setTimeout(() => void tick(), POLL_INTERVAL_MS);
}

export interface CloudControllerApi {
  createVM(spec: CreateVmSpec, provider?: CloudProviderName): Promise<VmRecord>;
  startVM(vmId: string, opts?: StartOptions): Promise<VmRecord>;
  stopVM(vmId: string, opts?: { provider?: CloudProviderName; sessionId?: string | null }): Promise<VmRecord>;
  getVMStatus(vmId: string, provider?: CloudProviderName): Promise<VmStatus>;
  checkVMReadiness(vmId: string, provider?: CloudProviderName): Promise<{ ready: boolean; detail: string }>;
  getVMInstanceView(vmId: string, provider?: CloudProviderName): Promise<VmInstanceView>;
  getVMDetails(vmId: string, opts?: { provider?: CloudProviderName; includeCloudMapping?: boolean }): Promise<VmDetails | null>;
  deleteVM(vmId: string, provider?: CloudProviderName): Promise<{ deleted: boolean }>;
}

interface StartOptions {
  provider?: CloudProviderName;
  durationMinutes?: number;
  sessionId?: string | null;
  adopt?: VmRecord;
}

export const cloudController: CloudControllerApi = {
  async createVM(spec, provider = "Azure") {
    const vm = await orchestrator.createVM(spec, provider);
    rememberMapping({
      workspaceId: spec.workspaceId,
      templateId: spec.templateId,
      labId: spec.labId,
      vmId: vm.id,
      azureSubscriptionId: await subscriptionId(),
      azureResourceGroup: await resourceGroup(),
      azureVmName: vm.name,
      azureResourceId: await azureResourceId(vm.name),
      azureRegion: vm.region,
    });
    if (spec.sessionId) {
      await publishLifecycle({
        sessionId: spec.sessionId,
        vmId: vm.id,
        phase: "REQUESTED",
        message: "Lab request accepted; a machine has been assigned.",
      });
    }
    return vm;
  },

  async startVM(vmId, opts = {}) {
    const provider = opts.provider ?? "Azure";
    const sessionId = opts.sessionId ?? null;
    if (sessionId) {
      await publishLifecycle({ sessionId, vmId, phase: "REQUESTED", message: "Start requested; contacting the cloud provider." });
    }
    try {
      const vm = await orchestrator.startVM(vmId, {
        provider,
        ...(opts.durationMinutes === undefined ? {} : { durationMinutes: opts.durationMinutes }),
        ...(opts.adopt === undefined ? {} : { adopt: opts.adopt }),
      });
      await emit(sessionId, vm);
      if (sessionId) watch(vmId, sessionId, provider);
      return vm;
    } catch (error) {
      if (sessionId) {
        await publishLifecycle({
          sessionId,
          vmId,
          phase: "ERROR",
          message: "The cloud provider could not start this machine.",
        });
      }
      throw error;
    }
  },

  async stopVM(vmId, opts = {}) {
    const vm = await orchestrator.stopVM(vmId, opts.provider ?? "Azure");
    if (opts.sessionId) {
      await publishLifecycle({ sessionId: opts.sessionId, vmId, phase: "STOPPED", message: "Machine stopped and deallocated." });
    }
    return vm;
  },

  async getVMStatus(vmId, provider = "Azure") {
    return orchestrator.getVMStatus(vmId, provider);
  },

  async checkVMReadiness(vmId, provider = "Azure") {
    return orchestrator.checkVMReadiness(vmId, provider);
  },

  /** Runtime view (Azure instance view). Admin/server use only. */
  async getVMInstanceView(vmId, provider = "Azure") {
    return orchestrator.getVMInstanceView(vmId, provider);
  },

  async getVMDetails(vmId, opts = {}) {
    const vm = await orchestrator.getVM(vmId, opts.provider ?? "Azure");
    if (!vm) return null;
    const mapping = mappingFor(vmId);
    const details: VmDetails = {
      vmId: vm.id,
      name: vm.name,
      provider: vm.provider,
      region: vm.region,
      size: vm.size,
      image: vm.image,
      status: vm.status,
      phase: phaseFor(vm.status),
      workspaceId: vm.workspaceId,
      labId: vm.labId,
      sessionId: vm.sessionId,
      startedAt: vm.startedAt,
      expiresAt: vm.expiresAt,
      readiness: vm.readiness,
    };
    if (opts.includeCloudMapping && mapping) details.cloudMapping = redactMapping(mapping);
    return details;
  },

  async deleteVM(vmId, provider = "Azure") {
    const result = await orchestrator.deleteVM(vmId, provider);
    forgetMapping(vmId);
    return result;
  },
};

/**
 * Azure identity of a machine. Read from server configuration only — these
 * values are never sent to the browser unmasked.
 */
async function subscriptionId() {
  const { azureConfig } = await import("@/lib/infra/runtime.server");
  return azureConfig()?.subscriptionId ?? "mock-subscription";
}

async function resourceGroup() {
  const { azureConfig } = await import("@/lib/infra/runtime.server");
  return azureConfig()?.resourceGroup ?? "skilltrack-labs-dev";
}

async function azureResourceId(vmName: string) {
  const sub = await subscriptionId();
  const rg = await resourceGroup();
  return `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
}