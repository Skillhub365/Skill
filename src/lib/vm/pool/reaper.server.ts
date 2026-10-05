/**
 * Automated session/VM reaper.
 *
 * Runs server-side on an interval and is the safety net behind the session
 * registry's own sweep:
 *   1. every known session is re-evaluated, so an elapsed session is marked
 *      EXPIRED even if no browser is polling it;
 *   2. every pooled machine whose session is no longer live is deallocated in
 *      Azure and returned to the pool.
 *
 * All actions are audited. The browser never triggers Azure work directly.
 */

import { audit, detectOrphans, ensurePoolLoaded, getPoolVm, listPoolVms, syncVm } from "./registry.server";
import { releaseVm } from "./allocator.server";
import { CONNECT_GRACE_MS, LAUNCH_TIMEOUT_MS, LIVE_SESSION_STATES } from "@/lib/session/types";
import type { PoolVm } from "./types";

const KEY = "__skilltrack_vm_reaper__";
const INTERVAL_MS = 30_000;

export interface ReaperRun {
  at: string;
  expiredSessions: number;
  releasedVms: number;
  orphans: number;
  /** Launches abandoned mid-flight and rolled back. */
  stuckLaunches: number;
  /** Allocation leases that outlived their launch and were reclaimed. */
  staleAllocations: number;
  /** Gateway connections torn down because their session is no longer live. */
  gatewayCleanups?: number;
  errors: string[];
}

interface ReaperState {
  started: boolean;
  lastRun: ReaperRun | null;
  running: boolean;
}

function state(): ReaperState {
  const g = globalThis as unknown as Record<string, ReaperState | undefined>;
  if (!g[KEY]) g[KEY] = { started: false, lastRun: null, running: false };
  return g[KEY]!;
}

function isLive(status: string | undefined) {
  return !!status && (LIVE_SESSION_STATES as readonly string[]).includes(status);
}

/** Pre-connection phases: the learner has not reached the desktop yet. */
const LAUNCHING_STATES = ["REQUESTED", "ALLOCATING", "CREATING", "STARTING", "BOOTING"];

/** Deallocate a machine in Azure and hand it back to the pool. */
export async function stopAndRelease(vmId: string, actor = "system"): Promise<PoolVm | null> {
  const vm = getPoolVm(vmId);
  if (!vm) return null;
  try {
    const { poolProvider } = await import("./provider.server");
    await poolProvider().stopVM(vm.id);
  } catch (error) {
    await audit(
      "vmpool.reclaim",
      actor,
      vm,
      error instanceof Error ? error.message : "Azure deallocation failed.",
      "failure",
    );
  }
  await syncVm(vm.id);
  const released = await releaseVm(vm.id, actor);
  await audit("vmpool.reclaim", actor, vm, `Stopped and released ${vm.azureVmName}.`);
  return released;
}

/** One reaper pass. Exposed so admins can run it on demand. */
export async function reapOnce(actor = "system"): Promise<ReaperRun> {
  const run: ReaperRun = {
    at: new Date().toISOString(),
    expiredSessions: 0,
    releasedVms: 0,
    orphans: 0,
    stuckLaunches: 0,
    staleAllocations: 0,
    gatewayCleanups: 0,
    errors: [],
  };
  const s = state();
  if (s.running) return s.lastRun ?? run;
  s.running = true;
  try {
    await ensurePoolLoaded();
    const sessions = await import("@/lib/session/registry.server");
    const nowMs = Date.now();

    // 1. expire elapsed sessions (this also terminates the connection and
    //    deallocates the VM through the orchestrator).
    for (const record of await sessions.listSessions()) {
      if (!isLive(record.status)) continue;

      // 1a. a launch that never reached the desktop is failed and rolled back,
      //     so the machine cannot be stranded by a crashed request.
      const startedMs = new Date(record.startTime).getTime();
      if (LAUNCHING_STATES.includes(record.status) && nowMs - startedMs > LAUNCH_TIMEOUT_MS) {
        await sessions.failSession(record.id, "The lab did not finish starting in time and was cancelled.");
        run.stuckLaunches += 1;
        continue;
      }

      // 1b. a READY session nobody ever connected to is reclaimed, so an
      //     abandoned click does not hold a machine for its full duration.
      if (record.status === "READY" && record.connectionStatus === "NONE" && nowMs - startedMs > CONNECT_GRACE_MS) {
        await sessions.stopSession(record.id, "expired");
        run.stuckLaunches += 1;
        continue;
      }

      const evaluated = await sessions.evaluate(record.id);
      if (evaluated && evaluated.status === "EXPIRED") run.expiredSessions += 1;
    }

    // 2. release pooled machines whose session has ended.
    //    Machines dedicated to a live persistent grant are kept assigned: the
    //    learner must find the same desktop and files on their next session.
    const { isPersistentlyBound } = await import("@/lib/labs/persistent-vm.server");
    for (const vm of listPoolVms()) {
      if (!vm.currentSessionId) continue;
      const record = await sessions.getSessionRaw(vm.currentSessionId);
      if (record && isLive(record.status)) continue;
      if (await isPersistentlyBound(vm.id)) {
        const { unbindSession } = await import("./allocator.server");
        await unbindSession(vm.id).catch(() => null);
        continue;
      }
      try {
        await stopAndRelease(vm.id, actor);
        run.releasedVms += 1;
      } catch (error) {
        run.errors.push(error instanceof Error ? error.message : "release failed");
      }
    }

    // 3. flag anything still running in Azure without a session.
    run.orphans = (await detectOrphans()).length;

    // 4. reclaim allocation leases whose launch never completed. The lease is
    //    durable, so this also cleans up after an instance that died.
    try {
      const { listStaleAllocations } = await import("@/lib/db/vm-pool.repo.server");
      for (const stale of await listStaleAllocations()) {
        const owner = stale.currentSessionId ? await sessions.getSessionRaw(stale.currentSessionId) : null;
        if (owner && isLive(owner.status)) continue;
        if (await isPersistentlyBound(stale.id)) continue;
        await stopAndRelease(stale.id, `${actor}:stale-lease`);
        run.staleAllocations += 1;
      }
    } catch (error) {
      run.errors.push(error instanceof Error ? error.message : "stale lease sweep failed");
    }

    // 5. remove gateway objects (connection + ephemeral account) left behind
    //    by a session that has ended, so no standing desktop grant survives.
    try {
      const { listUncleanedGateways, markGatewayCleaned } = await import("@/lib/db/gateway-connections.repo.server");
      const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
      for (const record of await listUncleanedGateways()) {
        const owner = await sessions.getSessionRaw(record.sessionId).catch(() => null);
        const expired = record.expiresAt ? new Date(record.expiresAt).getTime() < nowMs : false;
        if (owner && isLive(owner.status) && !expired) continue;
        await remoteDesktop().terminateConnection(record.sessionId).catch(() => null);
        await markGatewayCleaned(record.sessionId, "Cleaned up by the session reaper.");
        run.gatewayCleanups = (run.gatewayCleanups ?? 0) + 1;
      }
    } catch (error) {
      run.errors.push(error instanceof Error ? error.message : "gateway cleanup sweep failed");
    }

    // 6. persistent grants whose access window closed (or whose hours ran out)
    //    give their dedicated machine back to the shared pool.
    try {
      const { reclaimEndedGrants } = await import("@/lib/labs/persistent-vm.server");
      run.releasedVms += await reclaimEndedGrants(actor);
    } catch (error) {
      run.errors.push(error instanceof Error ? error.message : "persistent grant sweep failed");
    }
  } catch (error) {
    run.errors.push(error instanceof Error ? error.message : "reaper failed");
  } finally {
    s.running = false;
    s.lastRun = run;
    await recordRunMetrics(run);
  }
  return run;
}

export function lastReaperRun(): ReaperRun | null {
  return state().lastRun;
}

/** Lazily start the background loop (never at module scope). */
export function ensureReaper() {
  const s = state();
  if (s.started) return s;
  s.started = true;
  try {
    setInterval(() => {
      void reapOnce().catch(() => null);
    }, INTERVAL_MS);
  } catch {
    /* runtimes without long-lived timers reap on demand instead */
  }
  return s;
}


/**
 * Publish one cleanup run as metrics and one structured log line, so the
 * operations console and the alert rules can see cleanup health without
 * scraping the reaper's internal state.
 */
async function recordRunMetrics(run: ReaperRun) {
  try {
    const { recordMetric, METRIC } = await import("@/lib/observability/metrics.server");
    const { log } = await import("@/lib/observability/logger.server");
    recordMetric(METRIC.cleanupRun, 1, { outcome: run.errors.length ? "failure" : "success" });
    if (run.expiredSessions) recordMetric(METRIC.sessionExpired, run.expiredSessions);
    if (run.stuckLaunches) recordMetric(METRIC.sessionAbandoned, run.stuckLaunches);
    if (run.releasedVms) recordMetric(METRIC.orphanReclaimed, run.releasedVms);
    if (run.orphans) recordMetric(METRIC.orphanDetected, run.orphans);
    for (const _error of run.errors) recordMetric(METRIC.cleanupFailure, 1, { outcome: "failure" });
    log.info({
      event: "cleanup.run.completed",
      outcome: run.errors.length ? "failure" : "success",
      expiredSessions: run.expiredSessions,
      releasedVms: run.releasedVms,
      orphans: run.orphans,
      stuckLaunches: run.stuckLaunches,
      staleAllocations: run.staleAllocations,
      errorCount: run.errors.length,
    });
  } catch {
    /* observability must never break cleanup */
  }
}
