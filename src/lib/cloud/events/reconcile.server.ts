/**
 * Durable reconciliation: the safety net under Event Grid.
 *
 * Events can be dropped, delayed or delivered while a worker is restarting, so
 * SkillTrack periodically re-reads Azure for every registered machine and
 * corrects drift. This is deliberately the slow path — Event Grid is the fast
 * one — and it is also the only place that can notice a machine that vanished
 * from Azure entirely.
 */

import { STALE_AFTER_MS, type ReconcileFinding, type ReconcileSummary } from "./types";

const KEY = "__skilltrack_azure_reconcile__";
interface State {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  last: ReconcileSummary | null;
}
function state(): State {
  const g = globalThis as unknown as Record<string, State | undefined>;
  if (!g[KEY]) g[KEY] = { timer: null, running: false, last: null };
  return g[KEY]!;
}

export function lastReconcileSummary(): ReconcileSummary | null {
  return state().last;
}

const DEFAULT_INTERVAL_MS = 10 * 60_000;

function normalisePower(value: string) {
  const v = (value ?? "").toLowerCase();
  if (v.includes("running")) return "running";
  if (v.includes("dealloc")) return "deallocated";
  if (v.includes("stopp")) return "stopped";
  if (v.includes("start")) return "starting";
  return v || "unknown";
}

/**
 * One reconciliation pass over every registered machine.
 * Returns a redacted summary safe to show an administrator.
 */
export async function reconcileOnce(actor = "system"): Promise<ReconcileSummary> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const findings: ReconcileFinding[] = [];
  let corrected = 0;
  let orphans = 0;
  let missing = 0;
  let stale = 0;
  let failures = 0;

  const registry = await import("@/lib/vm/pool/registry.server");
  await registry.ensurePoolLoaded();
  const { armClientFor } = await import("@/lib/cloud/connections/registry.server");
  const { getSessionRaw } = await import("@/lib/session/registry.server");

  const vms = registry.listPoolVms();
  const connectionIds = new Set(vms.map((v) => v.cloudConnectionId));
  const armCache = new Map<string, Awaited<ReturnType<typeof armClientFor>>>();

  for (const vm of vms) {
    if (vm.mock) continue;
    try {
      if (!armCache.has(vm.cloudConnectionId)) {
        armCache.set(vm.cloudConnectionId, await armClientFor(vm.cloudConnectionId));
      }
      const arm = armCache.get(vm.cloudConnectionId);
      if (!arm) {
        failures += 1;
        continue;
      }

      let powerState: string | null = null;
      try {
        const view = await arm.getInstanceView(vm.resourceGroup, vm.azureVmName);
        powerState = view.powerState;
      } catch (error) {
        const message = (error as Error)?.message ?? "";
        // A 404 from ARM means the resource is gone, not that Azure is broken.
        if (/not\s*found|404/i.test(message)) {
          missing += 1;
          findings.push({
            vmId: vm.id,
            vmName: vm.name,
            kind: "missing",
            expected: "resource exists",
            actual: "not found in Azure",
            corrected: true,
          });
          registry.applyAzureSignal(vm.id, {
            powerState: "VM deleted",
            status: vm.currentSessionId ? undefined : "ERROR",
            error: "The Azure resource for this machine no longer exists.",
            azureMissing: true,
            driftDetected: true,
            driftDetail: "Azure no longer returns this resource.",
            source: "reconciliation",
            reconciled: true,
          });
          continue;
        }
        failures += 1;
        continue;
      }

      const azure = normalisePower(powerState);
      const known = normalisePower(vm.powerState);
      const drifted = azure !== known;

      const session = vm.currentSessionId ? await getSessionRaw(vm.currentSessionId) : null;
      const sessionLive = session
        ? session.status === "ACTIVE" || session.status === "STARTING" || session.status === "DISCONNECTING"
        : false;
      const isOrphan = azure === "running" && !sessionLive;
      if (isOrphan) {
        orphans += 1;
        findings.push({
          vmId: vm.id,
          vmName: vm.name,
          kind: "orphan",
          expected: "no active session -> deallocated",
          actual: "running in Azure",
          corrected: false,
        });
      }

      const lastSignal = vm.lastAzureEventAt ?? vm.lastSyncedAt;
      const isStale = !lastSignal || Date.now() - Date.parse(lastSignal) > STALE_AFTER_MS;
      if (isStale) stale += 1;

      if (drifted) {
        corrected += 1;
        findings.push({
          vmId: vm.id,
          vmName: vm.name,
          kind: "drift",
          expected: known,
          actual: azure,
          corrected: true,
        });
      }

      registry.applyAzureSignal(vm.id, {
        powerState,
        status: sessionLive ? undefined : azure === "running" ? "RUNNING" : "AVAILABLE",
        error: null,
        azureMissing: false,
        driftDetected: drifted || isOrphan,
        driftDetail: drifted
          ? `SkillTrack held "${known}", Azure reports "${azure}".`
          : isOrphan
            ? "Running in Azure with no active session."
            : null,
        source: "reconciliation",
        reconciled: true,
      });
    } catch {
      failures += 1;
    }
  }

  const finished = Date.now();
  const summary: ReconcileSummary = {
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    connectionsChecked: connectionIds.size,
    vmsChecked: vms.filter((v) => !v.mock).length,
    corrected,
    orphans,
    missing,
    stale,
    failures,
    findings: findings.slice(0, 100),
  };
  state().last = summary;

  const { recordReconciliation } = await import("./status.server");
  for (const id of connectionIds) recordReconciliation(id, summary);

  try {
    const { recordCloudAudit, SYSTEM_ACTOR } = await import("@/lib/cloud/audit/audit-log.server");
    recordCloudAudit({
      action: "cloud.reconcile",
      outcome: failures ? "failure" : "success",
      actor: actor === "system" ? SYSTEM_ACTOR : { sub: actor, role: "superadmin", name: actor },
      detail: `Checked ${summary.vmsChecked} machines: ${corrected} corrected, ${orphans} orphaned, ${missing} missing, ${stale} stale, ${failures} failed.`,
      durationMs: summary.durationMs,
    });
  } catch {
    /* auditing is best-effort */
  }
  return summary;
}

/** Start the background reconciliation ticker exactly once per worker. */
export function ensureReconciler(intervalMs = DEFAULT_INTERVAL_MS) {
  const s = state();
  if (s.timer || intervalMs <= 0) return { running: Boolean(s.timer), intervalMs };
  s.timer = setInterval(() => {
    if (s.running) return;
    s.running = true;
    void reconcileOnce()
      .catch(() => null)
      .finally(() => {
        s.running = false;
      });
  }, intervalMs);
  return { running: true, intervalMs };
}