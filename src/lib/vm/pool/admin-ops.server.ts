/**
 * Super Admin VM operations.
 *
 * These are the direct capacity controls behind the VM Pool console: boot a
 * registered Azure machine, deallocate it, probe Azure, and validate that the
 * remote-desktop path would work — all without a learner session in play.
 *
 * Invariants:
 *  - Azure is only ever contacted from here, through the ARM client of the
 *    cloud connection that owns the machine. The browser never talks to Azure.
 *  - Nothing returned by this module contains credentials, private addresses,
 *    Guacamole tokens or raw provider payloads.
 *  - Every operation is written to the cloud audit trail, the platform
 *    activity feed and the lifecycle event stream.
 */

import { armClientFor, getConnection } from "@/lib/cloud/connections/registry.server";
import { AzureConnectionError } from "@/lib/cloud/connections/azure-arm.server";
import {
  audit,
  ensurePoolLoaded,
  getPoolVm,
  patchVm,
  PoolError,
  statusFromPowerState,
  syncVm,
} from "./registry.server";
import type { PoolVm, PoolVmKind, RdpTestResult, RdpTestStep, VmTestResult } from "./types";

/* ------------------------------------------------------------ classification */

/**
 * How a registered machine is actually backed right now. Admins must be able
 * to tell a real Azure machine from a development sample at a glance.
 */
export function poolVmKind(vm: PoolVm): PoolVmKind {
  if (vm.mock) return "mock";
  const connection = getConnection(vm.cloudConnectionId);
  if (!connection || connection.status !== "CONNECTED") return "unavailable";
  return "azure";
}

/** Live/dev posture of the whole console, shown as a banner. */
export async function poolRuntimeBadge() {
  const { infraModes } = await import("@/lib/infra/runtime.server");
  const modes = infraModes();
  return {
    environment: modes.environment,
    vmMode: modes.vm,
    remoteDesktopMode: modes.remoteDesktop,
    azureConfigured: modes.azureConfigured,
    guacamoleConfigured: modes.guacamoleConfigured,
    degraded: modes.degraded,
    degradedReasons: modes.degradedReasons,
  };
}

/* ----------------------------------------------------------------- helpers */

function requireVm(vmId: string): PoolVm {
  const vm = getPoolVm(vmId);
  if (!vm) throw new PoolError("This machine is not registered in the pool.");
  return vm;
}

/**
 * A live deployment must never pretend to operate a machine it cannot reach.
 * Development is allowed to simulate, and says so.
 */
async function assertOperable(vm: PoolVm): Promise<PoolVmKind> {
  const kind = poolVmKind(vm);
  if (kind === "azure") return kind;
  const { deploymentEnvironment } = await import("@/lib/infra/runtime.server");
  if (kind === "mock") {
    if (deploymentEnvironment() === "development") return kind;
    throw new PoolError("This is a development sample machine and cannot be operated in a live environment.");
  }
  throw new PoolError("The cloud connection for this machine is unavailable. Re-validate it under Cloud Connections.");
}

async function trail(
  vm: PoolVm,
  actor: string,
  action: Parameters<typeof audit>[0],
  phase: string,
  detail: string,
  outcome: "success" | "failure" = "success",
) {
  await audit(action, actor, vm, detail, outcome);
  const events = await import("@/lib/db/events.repo.server");
  await Promise.all([
    events.recordActivity({
      tenantId: null,
      action: "VM_ADMIN_ACTION",
      actorName: actor,
      actorRole: "superadmin",
      targetType: "vm",
      targetId: vm.id,
      target: vm.azureVmName,
      workspaceId: vm.workspaceId,
      outcome,
      detail,
    }),
    events.recordLifecycleEvent({
      tenantId: null,
      entityType: "vm",
      entityId: vm.id,
      phase,
      status: outcome === "success" ? "ok" : "failed",
      detail,
      metadata: { operator: actor, azureVmName: vm.azureVmName, kind: poolVmKind(vm) },
    }),
  ]);
}

function friendlyAzure(error: unknown, fallback: string): string {
  if (error instanceof AzureConnectionError) return error.message;
  if (error instanceof PoolError) return error.message;
  console.error("[vm-pool] Azure operation failed:", error);
  return fallback;
}

/* -------------------------------------------------------------- operations */

/** Boot a registered machine so an operator can validate real capacity. */
export async function adminStartVm(vmId: string, actor: string): Promise<PoolVm> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  if (vm.status === "RETIRED") throw new PoolError("Retired machines cannot be started. Return it to service first.");
  const kind = await assertOperable(vm);

  try {
    if (kind === "azure") {
      const arm = await armClientFor(vm.cloudConnectionId);
      if (!arm) throw new PoolError("Connection credentials are unavailable.");
      await arm.startVirtualMachine(vm.resourceGroup, vm.azureVmName);
    }
    patchVm(vm.id, { status: "STARTING", powerState: "VM starting", error: null });
    await trail(vm, actor, "vm.start", "admin.start", `Start requested for ${vm.azureVmName}.`);
  } catch (error) {
    const message = friendlyAzure(error, "Azure refused the start request.");
    patchVm(vm.id, { status: "ERROR", error: message });
    await trail(vm, actor, "vm.start", "admin.start", message, "failure");
    throw new PoolError(message);
  }
  // Reflect the real power state as soon as Azure reports it.
  if (kind === "azure") await syncVm(vm.id).catch(() => null);
  return requireVm(vm.id);
}

/** Deallocate a machine (stops Azure billing for compute). */
export async function adminStopVm(vmId: string, actor: string, force = false): Promise<PoolVm> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  if (vm.currentSessionId && !force) {
    throw new PoolError("A learner session is using this machine. Release it first, or stop the session.");
  }
  const kind = await assertOperable(vm);

  try {
    if (kind === "azure") {
      const arm = await armClientFor(vm.cloudConnectionId);
      if (!arm) throw new PoolError("Connection credentials are unavailable.");
      await arm.deallocateVirtualMachine(vm.resourceGroup, vm.azureVmName);
    }
    const { forgetPrivateIp } = await import("../private-endpoints.server");
    forgetPrivateIp(vm.id);
    patchVm(vm.id, { status: "STOPPING", powerState: "VM deallocating", error: null });
    await trail(vm, actor, "vm.deallocate", "admin.stop", `Deallocation requested for ${vm.azureVmName}.`);
  } catch (error) {
    const message = friendlyAzure(error, "Azure refused the stop request.");
    patchVm(vm.id, { status: "ERROR", error: message });
    await trail(vm, actor, "vm.deallocate", "admin.stop", message, "failure");
    throw new PoolError(message);
  }
  if (kind === "azure") await syncVm(vm.id).catch(() => null);
  return requireVm(vm.id);
}

/**
 * Restart. Azure exposes a native restart for running machines; a deallocated
 * machine is simply started instead, which is what the operator means.
 */
export async function adminRestartVm(vmId: string, actor: string): Promise<{ vm: PoolVm; strategy: string }> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  const kind = await assertOperable(vm);
  const running = vm.powerState.toLowerCase().includes("running");

  if (!running) {
    const started = await adminStartVm(vmId, actor);
    return { vm: started, strategy: "The machine was deallocated, so it was started instead of restarted." };
  }

  try {
    if (kind === "azure") {
      const arm = await armClientFor(vm.cloudConnectionId);
      if (!arm) throw new PoolError("Connection credentials are unavailable.");
      await arm.request(`${vm.azureResourceId}/restart`, { method: "POST", apiVersion: "2024-07-01" });
    }
    patchVm(vm.id, { status: "STARTING", powerState: "VM starting", error: null });
    await trail(vm, actor, "vm.start", "admin.restart", `Restart requested for ${vm.azureVmName}.`);
  } catch (error) {
    // Fall back to the universally supported stop + start sequence.
    const detail = friendlyAzure(error, "Restart is unavailable for this machine.");
    await adminStopVm(vmId, actor, true);
    const started = await adminStartVm(vmId, actor);
    return { vm: started, strategy: `Restart was unavailable (${detail}) so the machine was stopped and started.` };
  }
  if (kind === "azure") await syncVm(vm.id).catch(() => null);
  return { vm: requireVm(vm.id), strategy: "Azure restart issued." };
}

/** Mark a machine unavailable for future learners without losing its history. */
export async function adminRetireVm(vmId: string, actor: string, retire: boolean): Promise<PoolVm> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  if (retire && vm.currentSessionId) throw new PoolError("Release the active session before retiring this machine.");
  if (retire) {
    patchVm(vm.id, { status: "RETIRED", orphaned: false });
  } else {
    const { restoreRetiredVm } = await import("./registry.server");
    restoreRetiredVm(vm.id);
  }
  await trail(
    vm,
    actor,
    retire ? "vmpool.retire" : "vmpool.restore",
    retire ? "admin.retire" : "admin.restore",
    retire
      ? `${vm.azureVmName} retired: no new learners will be allocated to it. The Azure machine was not deleted.`
      : `${vm.azureVmName} returned to service.`,
  );
  return requireVm(vm.id);
}

/** Pin a machine to one workspace (or make it available platform-wide). */
export async function adminAssignWorkspace(
  vmId: string,
  actor: string,
  workspaceId: string | null,
): Promise<PoolVm> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  if (vm.currentSessionId) throw new PoolError("This machine is in use; reassign it once the session ends.");
  patchVm(vm.id, { workspaceId });
  await trail(
    vm,
    actor,
    workspaceId ? "workspace.link" : "workspace.unlink",
    "admin.assign-workspace",
    workspaceId ? `Reserved for workspace ${workspaceId}.` : "Released back to the shared pool.",
  );
  return requireVm(vm.id);
}

/**
 * Reserve a machine for one learner and lab. This does not start a session —
 * it holds capacity so an operator can validate a specific learner's path.
 */
export async function adminAssignUserLab(
  vmId: string,
  actor: string,
  input: { userId: string | null; userName: string | null; labId: string | null; workspaceId?: string | null },
): Promise<PoolVm> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  if (vm.currentSessionId) throw new PoolError("This machine is running a session; reassign it once the session ends.");
  if (vm.status === "RETIRED") throw new PoolError("Retired machines cannot be reserved.");
  patchVm(vm.id, {
    assignedUserId: input.userId,
    assignedUserName: input.userName,
    labId: input.labId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
  });
  await trail(
    vm,
    actor,
    "vmpool.allocate",
    "admin.assign-user",
    input.userId
      ? `Reserved for ${input.userName ?? input.userId}${input.labId ? ` on lab ${input.labId}` : ""}.`
      : "Learner reservation cleared.",
  );
  return requireVm(vm.id);
}

/* ------------------------------------------------------------------- tests */

/** Probe Azure for the real state of one machine. Returns no raw ARM payload. */
export async function testAzureState(vmId: string, actor: string): Promise<VmTestResult> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  const kind = poolVmKind(vm);
  const startedAt = Date.now();

  if (kind === "mock") {
    return {
      ok: true,
      kind,
      powerState: vm.powerState,
      provisioningState: "Succeeded",
      agentReady: vm.powerState.toLowerCase().includes("running"),
      detail: "Development sample machine: state is simulated, Azure was not contacted.",
      durationMs: 0,
      checkedAt: new Date().toISOString(),
    };
  }
  if (kind === "unavailable") {
    return {
      ok: false,
      kind,
      powerState: vm.powerState,
      provisioningState: "Unknown",
      agentReady: false,
      detail: "The owning cloud connection has no usable credentials.",
      durationMs: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const arm = await armClientFor(vm.cloudConnectionId);
    if (!arm) throw new PoolError("Connection credentials are unavailable.");
    const view = await arm.getInstanceView(vm.resourceGroup, vm.azureVmName);
    patchVm(vm.id, {
      powerState: view.powerState,
      lastSyncedAt: new Date().toISOString(),
      error: null,
      ...(vm.currentSessionId || vm.status === "RETIRED"
        ? {}
        : { status: statusFromPowerState(view.powerState) === "RUNNING" ? "RUNNING" : "AVAILABLE" }),
    });
    await trail(vm, actor, "vm.status", "admin.test-azure", `Azure reports ${view.powerState}.`);
    return {
      ok: view.provisioningState.toLowerCase() !== "failed",
      kind,
      powerState: view.powerState,
      provisioningState: view.provisioningState,
      agentReady: view.agentReady,
      detail: view.agentReady
        ? "Azure responded and the guest agent is reporting in."
        : `Azure responded; the machine is ${view.powerState.toLowerCase()}.`,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const detail = friendlyAzure(error, "Azure could not be reached for this machine.");
    await trail(vm, actor, "vm.status", "admin.test-azure", detail, "failure");
    return {
      ok: false,
      kind,
      powerState: vm.powerState,
      provisioningState: "Unknown",
      agentReady: false,
      detail,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}

function step(label: string, status: RdpTestStep["status"], detail: string): RdpTestStep {
  return { label, status, detail };
}

/**
 * End-to-end readiness of the browser desktop path for one machine:
 *
 *   browser -> Guacamole (HTTPS/WSS) -> guacd -> RDP:3389 -> private Azure VM
 *
 * Every step reports pass/fail/skip with a plain-language reason. The private
 * address, RDP credentials and gateway administrator password are used only
 * server-side and are never part of the result.
 */
export async function testRdpReadiness(vmId: string, actor: string): Promise<RdpTestResult> {
  await ensurePoolLoaded();
  const vm = requireVm(vmId);
  const kind = poolVmKind(vm);
  const steps: RdpTestStep[] = [];
  const startedAt = Date.now();

  // 1. Registration
  steps.push(
    vm.status === "RETIRED"
      ? step("Machine is in service", "fail", "The machine is retired and will not be offered to learners.")
      : step("Machine is in service", "pass", `Registered against template ${vm.templateName}.`),
  );

  // 2. Power state
  const azure = await testAzureState(vmId, actor);
  const running = azure.powerState.toLowerCase().includes("running");
  steps.push(
    running
      ? step("Azure machine is running", "pass", azure.detail)
      : step("Azure machine is running", "fail", `Start the machine first — Azure reports ${azure.powerState}.`),
  );

  // 3. Private address (resolved server-side only)
  let hasPrivateIp = false;
  if (kind === "mock") {
    steps.push(step("Private address resolved", "skip", "Simulated machine: no private network address to resolve."));
    hasPrivateIp = true;
  } else if (!running) {
    steps.push(step("Private address resolved", "skip", "The machine must be running before its address can be read."));
  } else {
    try {
      const { resolvePrivateIp } = await import("./provider.server");
      const ip = await resolvePrivateIp(vm);
      hasPrivateIp = Boolean(ip);
      if (ip) {
        const { rememberPrivateIp } = await import("../private-endpoints.server");
        rememberPrivateIp(vm.id, ip);
      }
      steps.push(
        ip
          ? step("Private address resolved", "pass", "The gateway can reach the machine on its private network address.")
          : step("Private address resolved", "fail", "No network interface with a private address is attached."),
      );
    } catch {
      steps.push(step("Private address resolved", "fail", "The network interface could not be read from Azure."));
    }
  }

  // 4/5. Gateway configuration and liveness
  const { guacamoleConfig, infraModes } = await import("@/lib/infra/runtime.server");
  const modes = infraModes();
  const guac = guacamoleConfig();
  if (modes.remoteDesktop === "simulated") {
    steps.push(step("Remote desktop gateway configured", "skip", "This deployment serves the simulated desktop."));
    steps.push(step("Gateway reachable", "skip", "No gateway to contact in simulated mode."));
    steps.push(step("RDP credentials available", "skip", "The simulated desktop needs no RDP credentials."));
  } else {
    steps.push(
      guac
        ? step("Remote desktop gateway configured", "pass", "Gateway address and platform account are configured.")
        : step("Remote desktop gateway configured", "fail", "The gateway is not configured for this environment."),
    );
    if (guac) {
      const { gatewayHealth } = await import("@/lib/remote-desktop/service.server");
      const health = await gatewayHealth();
      steps.push(
        health.reachable
          ? step("Gateway reachable", "pass", health.detail)
          : step("Gateway reachable", "fail", health.detail),
      );
      steps.push(
        guac.rdpUsername && guac.rdpPassword
          ? step("RDP credentials available", "pass", "Lab image credentials are held in the platform secret store.")
          : step("RDP credentials available", "fail", "No lab image RDP credentials are configured."),
      );
    } else {
      steps.push(step("Gateway reachable", "skip", "Configure the gateway first."));
      steps.push(step("RDP credentials available", "skip", "Configure the gateway first."));
    }
  }

  // 6. Ephemeral brokered connection — only attempted when everything above is
  // green and the machine is idle, and always torn down afterwards.
  const blockers = steps.some((s) => s.status === "fail");
  if (blockers) {
    steps.push(step("Test desktop connection", "skip", "Earlier checks must pass before a test connection is brokered."));
  } else if (vm.currentSessionId) {
    steps.push(step("Test desktop connection", "skip", "A learner session is using this machine; no test connection was created."));
  } else if (modes.remoteDesktop === "simulated") {
    steps.push(step("Test desktop connection", "skip", "Simulated desktops are created on demand and need no gateway object."));
  } else if (!hasPrivateIp) {
    steps.push(step("Test desktop connection", "skip", "No private address to point a test connection at."));
  } else {
    // Broker a real connection object plus a scoped ephemeral account against
    // the machine's private address, then remove both.
    try {
      const { resolvePrivateIp } = await import("../private-endpoints.server");
      const ip = await resolvePrivateIp(vm.id);
      if (!ip || !guac) {
        steps.push(step("Test desktop connection", "skip", "No private address to point a test connection at."));
      } else {
        const { GuacamoleRemoteDesktopService } = await import("@/lib/remote-desktop/service.server");
        const probe = await new GuacamoleRemoteDesktopService(guac).selfTest({ privateIp: ip, label: vm.id });
        steps.push(
          probe.brokered && probe.tokenIssued
            ? step("Test desktop connection", "pass", probe.detail)
            : step("Test desktop connection", "fail", probe.detail),
        );
        steps.push(
          probe.cleanedUp
            ? step("Test objects removed", "pass", "The temporary connection and gateway account were deleted.")
            : step("Test objects removed", "fail", "A temporary gateway object was left behind and must be removed."),
        );
      }
    } catch (error) {
      const { normalizeGatewayError } = await import("@/lib/remote-desktop/gateway-errors");
      steps.push(step("Test desktop connection", "fail", normalizeGatewayError(error).friendly));
    }
  }

  const failed = steps.filter((s) => s.status === "fail");
  const result: RdpTestResult = {
    ready: failed.length === 0,
    mode: modes.remoteDesktop,
    kind,
    steps,
    summary:
      failed.length === 0
        ? "This machine can serve a browser desktop."
        : `${failed.length} check(s) must be fixed before a learner can connect.`,
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
  await trail(
    vm,
    actor,
    "vm.status",
    "admin.test-rdp",
    `Remote desktop readiness: ${result.summary}`,
    result.ready ? "success" : "failure",
  );
  try {
    const { recordGatewayTest } = await import("@/lib/remote-desktop/health.server");
    recordGatewayTest({
      at: result.checkedAt,
      machine: vm.name,
      actor,
      ok: result.ready,
      cleanedUp: !steps.some((s) => s.label === "Test objects removed" && s.status === "fail"),
      detail: result.summary,
    });
  } catch {
    /* health bookkeeping must never fail a diagnostic run */
  }
  return result;
}
