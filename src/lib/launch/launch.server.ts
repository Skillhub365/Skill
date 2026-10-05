/**
 * Lab launch, independent of transport.
 *
 * Both the browser API route and the MCP agent tools call this, so a lab
 * started by an assistant goes through exactly the same resolution, quota,
 * allocation, idempotency and rollback path as one started in the UI.
 */

import type { Principal, SecurityErrorCode } from "@/lib/security/types";

/** The full authenticated principal: entitlements are read from it, not trusted from input. */
export type LaunchPrincipal = Principal & { tenantId?: string | null };

export interface LaunchInput {
  labId: string;
  principal: LaunchPrincipal;
  /** Idempotency key: a retry with the same key reuses the in-flight launch. */
  launchKey?: string | undefined;
  correlationId: string;
  /** How the launch was requested — recorded on metrics only. */
  channel?: "web" | "mcp";
}

export type LaunchResult =
  | { ok: true; sessionId: string; session: unknown; vm: unknown; reused: boolean }
  | { ok: false; code: SecurityErrorCode; detail?: string };

export async function launchLab(input: LaunchInput): Promise<LaunchResult> {
  const { labId, principal, correlationId } = input;
  const channel = input.channel ?? "web";
  const startedAt = Date.now();
  const { bindLogger, safeMessage } = await import("@/lib/observability/logger.server");
  const { recordMetric, recordDuration, METRIC } = await import("@/lib/observability/metrics.server");
  let logger = bindLogger("launch", { correlationId, labId, userId: principal.sub });

  recordMetric(METRIC.launchRequested, 1, { labId, userId: principal.sub, correlationId, metadata: { channel } });

  const { resolveLaunchPlan } = await import("@/lib/db/launch.repo.server");
  const resolution = await resolveLaunchPlan(labId, principal);
  if (!resolution.ok) return { ok: false, code: resolution.reason, ...(resolution.detail ? { detail: resolution.detail } : {}) };
  const { plan } = resolution;
  logger = logger.child({ tenantId: plan.tenantId, workspaceId: plan.workspace.id, provider: plan.template.provider });
  logger.info({ event: "lab.launch.resolved", message: "Launch plan resolved from durable records." });

  // Persistent labs: the access window and hour allowance are policy, checked
  // before any cloud work happens.
  const persistent = plan.lab.labMode === "persistent";
  let accessRemainingMinutes = Number.POSITIVE_INFINITY;
  if (persistent) {
    const { evaluateAccess } = await import("@/lib/labs/persistence");
    const { emptyAccess } = await import("@/lib/labs/persistence");
    const grant = plan.assignment;
    const evaluation = evaluateAccess(grant?.access ?? emptyAccess(), { status: grant?.status ?? "revoked" });
    if (!evaluation.allowed) {
      const code: SecurityErrorCode =
        evaluation.reason === "NOT_STARTED"
          ? "ACCESS_NOT_STARTED"
          : evaluation.reason === "ENDED"
            ? "ACCESS_ENDED"
            : evaluation.reason === "NO_MINUTES"
              ? "ALLOWANCE_EXHAUSTED"
              : "FORBIDDEN_LAB";
      logger.warn({ event: "lab.launch.access_denied", errorCode: code, outcome: "failure" });
      return { ok: false, code, detail: evaluation.message };
    }
    accessRemainingMinutes = evaluation.remainingMinutes;
  }

  const { orchestrator } = await import("@/lib/vm/orchestrator.server");
  const { cloudController } = await import("@/lib/cloud/controller.server");
  const sessions = await import("@/lib/session/registry.server");

  const launchKey = input.launchKey ?? `${principal.sub}:${labId}`;
  const existing =
    (await sessions.findSessionByLaunchKey(launchKey)) ?? (await sessions.findLiveSessionFor(principal.sub, labId));
  if (existing) {
    const currentVm = await orchestrator.getVM(existing.vmId, plan.template.provider);
    recordMetric(METRIC.launchReused, 1, {
      labId,
      userId: principal.sub,
      sessionId: existing.id,
      workspaceId: plan.workspace.id,
      tenantId: plan.tenantId,
      correlationId,
      metadata: { channel },
    });
    logger.info({ event: "lab.launch.reused", sessionId: existing.id, outcome: "success" });
    return { ok: true, sessionId: existing.id, session: existing, vm: currentVm, reused: true };
  }

  const { checkCapacity, clampDuration } = await import("@/lib/launch/policy.server");
  const capacity = await checkCapacity({
    tenantId: plan.tenantId,
    workspaceId: plan.workspace.id,
    userId: principal.sub,
    templateId: plan.template.id,
  });
  if (!capacity.ok) {
    recordMetric(METRIC.quotaDenied, 1, {
      labId,
      userId: principal.sub,
      workspaceId: plan.workspace.id,
      tenantId: plan.tenantId,
      correlationId,
      outcome: "failure",
      metadata: { reason: capacity.reason, channel },
    });
    logger.warn({ event: "lab.launch.quota_denied", errorCode: capacity.reason, outcome: "failure" });
    return { ok: false, code: capacity.reason, ...(capacity.detail ? { detail: capacity.detail } : {}) };
  }
  // A persistent session may never run longer than the hours the learner has left.
  const durationMinutes = Math.max(
    5,
    Math.min(clampDuration(plan.durationMinutes, capacity.policy), accessRemainingMinutes),
  );

  // The remote desktop path must be proven reachable — from the app and from
  // the lab network — before any learner machine is started.
  const { gatewayReadyForSessions } = await import("@/lib/remote-desktop/gateway-setup.server");
  const gate = await gatewayReadyForSessions();
  if (!gate.allowed) {
    logger.warn({ event: "lab.launch.gateway_unverified", errorCode: "CONNECTION_FAILED", outcome: "failure" });
    return { ok: false, code: "CONNECTION_FAILED", ...(gate.detail ? { detail: gate.detail } : {}) };
  }

  let allocatedVmId: string | null = null;
  let createdSessionId: string | null = null;
  try {
    // Resume the learner's dedicated machine when one is already bound to the
    // grant; otherwise allocate a new one and bind it for the access window.
    const boundVmId = persistent ? (plan.assignment?.access.persistentVmId ?? null) : null;
    let resumedVm = null as Awaited<ReturnType<typeof orchestrator.getVM>> | null;
    if (boundVmId) {
      resumedVm = await orchestrator.getVM(boundVmId, plan.template.provider).catch(() => null);
      if (resumedVm) logger.info({ event: "lab.launch.resumed_vm", vmId: boundVmId });
    }

    const vm =
      resumedVm ??
      (await cloudController.createVM(
        {
          templateId: plan.template.id,
          name: `${plan.workspace.slug}-${labId.slice(-4)}-${Math.floor(Math.random() * 90 + 10)}`,
          region: plan.template.region,
          size: plan.template.size,
          image: plan.template.image,
          workspaceId: plan.workspace.id,
          workspaceName: plan.workspace.name,
          labId,
          labName: plan.lab.title,
          userId: principal.sub,
          userName: principal.name ?? "Learner",
          sessionId: null,
          durationMinutes,
        },
        plan.template.provider,
      ));
    // A resumed machine is never rolled back into the pool on failure.
    allocatedVmId = resumedVm ? null : vm.id;
    recordDuration(METRIC.vmAllocationMs, Date.now() - startedAt, {
      labId,
      workspaceId: plan.workspace.id,
      tenantId: plan.tenantId,
      vmId: vm.id,
      correlationId,
      outcome: "success",
    });

    const session = await sessions.createSession({
      userId: principal.sub,
      userName: principal.name ?? "Learner",
      workspaceId: plan.workspace.id,
      workspaceName: plan.workspace.name,
      workspaceSlug: plan.workspace.slug,
      labId,
      labName: plan.lab.title,
      vmId: vm.id,
      vmName: vm.name,
      provider: plan.template.provider,
      durationMinutes,
      maxExtensionMinutes: plan.maxExtensionMinutes,
      tenantId: plan.tenantId,
      launchKey,
      vmSize: plan.template.size,
      ...(plan.assignment ? { assignmentId: plan.assignment.id } : {}),
      labMode: plan.lab.labMode,
    });
    createdSessionId = session.id;
    logger = logger.child({ sessionId: session.id, vmId: vm.id });

    const { isPoolVmId } = await import("@/lib/vm/pool/registry.server");
    if (isPoolVmId(vm.id)) {
      const { bindSession } = await import("@/lib/vm/pool/allocator.server");
      await bindSession(vm.id, session.id);
    }

    if (persistent && plan.assignment) {
      const { bindPersistentVm, markStarted } = await import("@/lib/labs/persistent-vm.server");
      if (resumedVm) await markStarted(plan.assignment.id);
      else await bindPersistentVm(plan.assignment.id, vm.id);
    }

    const started = await cloudController.startVM(vm.id, {
      provider: plan.template.provider,
      durationMinutes,
      sessionId: session.id,
    });

    recordDuration(METRIC.vmStartMs, Date.now() - startedAt, {
      labId,
      workspaceId: plan.workspace.id,
      tenantId: plan.tenantId,
      sessionId: session.id,
      vmId: vm.id,
      correlationId,
      outcome: "success",
    });
    recordMetric(METRIC.launchSucceeded, 1, {
      labId,
      userId: principal.sub,
      workspaceId: plan.workspace.id,
      tenantId: plan.tenantId,
      sessionId: session.id,
      vmId: vm.id,
      correlationId,
      outcome: "success",
      metadata: { channel },
    });
    logger.info({ event: "lab.launch.succeeded", durationMs: Date.now() - startedAt, outcome: "success" });

    return { ok: true, sessionId: session.id, session, vm: { ...started, sessionId: session.id }, reused: false };
  } catch (error) {
    await compensate(allocatedVmId, createdSessionId, error);
    const { NoCapacityError } = await import("@/lib/vm/pool/allocator.server");
    const { normalizeAzureError } = await import("@/lib/cloud/azure-errors");
    const normalized =
      error instanceof NoCapacityError
        ? { code: "VM_UNAVAILABLE" as const, message: error.message, azureCode: null }
        : normalizeAzureError(error);
    recordMetric(METRIC.launchFailed, 1, {
      labId,
      userId: principal.sub,
      workspaceId: plan.workspace.id,
      tenantId: plan.tenantId,
      sessionId: createdSessionId,
      vmId: allocatedVmId,
      correlationId,
      outcome: "failure",
      metadata: { errorCode: normalized.code, providerCode: normalized.azureCode ?? null, channel },
    });
    logger.error({
      event: "lab.launch.failed",
      errorCode: normalized.code,
      durationMs: Date.now() - startedAt,
      outcome: "failure",
      message: safeMessage(error, "Lab launch failed."),
    });
    return { ok: false, code: normalized.code, detail: normalized.message };
  }
}

/** Roll back a partial launch: fail the session, stop and release the VM. */
async function compensate(vmId: string | null, sessionId: string | null, error: unknown) {
  const message = error instanceof Error ? error.message : "Lab launch failed.";
  try {
    if (sessionId) {
      const sessions = await import("@/lib/session/registry.server");
      await sessions.failSession(sessionId, message);
    }
    if (vmId) {
      const { isPoolVmId } = await import("@/lib/vm/pool/registry.server");
      if (isPoolVmId(vmId)) {
        const { orchestrator } = await import("@/lib/vm/orchestrator.server");
        await orchestrator.stopVM(vmId).catch(() => null);
        const { releaseVm } = await import("@/lib/vm/pool/allocator.server");
        await releaseVm(vmId, "system:launch-rollback");
      }
    }
  } catch (cleanupError) {
    console.error("Launch rollback failed:", cleanupError instanceof Error ? cleanupError.message : cleanupError);
  }
}
