/**
 * Scheduled Azure resource refresh, configured per cloud connection.
 *
 * A single ticker wakes frequently and refreshes any connection whose own
 * interval has elapsed. Each connection can be paused/resumed independently
 * and can carry a custom interval; last and next run timestamps are exposed to
 * the admin UI. Runs are server-side only, never overlap for one connection,
 * and every attempt is audited as a `system` actor and sampled for health.
 *
 * CLOUD_REFRESH_INTERVAL_MS sets the default interval (5 minutes); 0 pauses
 * every connection by default.
 */

import { recordCloudAudit, normalizeErrorCode, SYSTEM_ACTOR } from "@/lib/cloud/audit/audit-log.server";
import { listConnections, getConnection } from "./registry.server";
import { multiCloudController } from "./controller.server";
import { recordHealthSample } from "./health.server";
import {
  MAX_REFRESH_INTERVAL_MS,
  MIN_REFRESH_INTERVAL_MS,
  type ConnectionSchedule,
} from "./health-types";

export interface ScheduleState {
  enabled: boolean;
  intervalMs: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  running: boolean;
  runs: number;
  failures: number;
}

const DEFAULT_INTERVAL = 5 * 60_000;
/** How often the ticker checks which connections are due. */
const TICK_MS = 15_000;

interface Entry {
  paused: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunDueAt: number;
  lastOutcome: "success" | "failure" | null;
  runs: number;
  failures: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let defaultInterval = DEFAULT_INTERVAL;
let defaultPaused = false;
let lastTickAt: string | null = null;
const entries = new Map<string, Entry>();
const inFlight = new Set<string>();

function configuredInterval() {
  const raw = Number(process.env["CLOUD_REFRESH_INTERVAL_MS"] ?? "");
  if (Number.isFinite(raw) && raw === 0) return 0;
  if (Number.isFinite(raw) && raw > 0) return Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, raw));
  return DEFAULT_INTERVAL;
}

function entryFor(connectionId: string): Entry {
  let entry = entries.get(connectionId);
  if (!entry) {
    entry = {
      paused: defaultPaused,
      intervalMs: defaultInterval || DEFAULT_INTERVAL,
      lastRunAt: null,
      nextRunDueAt: Date.now() + (defaultInterval || DEFAULT_INTERVAL),
      lastOutcome: null,
      runs: 0,
      failures: 0,
    };
    entries.set(connectionId, entry);
  }
  return entry;
}

function toSchedule(connectionId: string, entry: Entry): ConnectionSchedule {
  return {
    connectionId,
    paused: entry.paused,
    intervalMs: entry.intervalMs,
    lastRunAt: entry.lastRunAt,
    nextRunAt: entry.paused ? null : new Date(entry.nextRunDueAt).toISOString(),
    lastOutcome: entry.lastOutcome,
    running: inFlight.has(connectionId),
    runs: entry.runs,
    failures: entry.failures,
  };
}

/** Refresh one connection, auditing the attempt as a scheduled system action. */
export async function refreshConnectionOnSchedule(connectionId: string): Promise<boolean> {
  if (inFlight.has(connectionId)) return false;
  const connection = getConnection(connectionId);
  if (!connection) return false;
  const entry = entryFor(connectionId);
  inFlight.add(connectionId);
  const startedAt = Date.now();
  try {
    const { inventory } = await multiCloudController.refreshResources(connectionId);
    const durationMs = Date.now() - startedAt;
    entry.runs += 1;
    entry.lastOutcome = "success";
    entry.lastRunAt = new Date().toISOString();
    entry.nextRunDueAt = Date.now() + entry.intervalMs;
    recordHealthSample({
      connectionId,
      source: "scheduled-refresh",
      ok: true,
      status: "OK",
      latencyMs: durationMs,
      message: `${inventory.virtualMachines.length} VMs discovered`,
    });
    recordCloudAudit({
      action: "connection.scheduled-refresh",
      outcome: "success",
      actor: SYSTEM_ACTOR,
      connectionId,
      connectionName: connection.name,
      subscriptionId: connection.subscriptionId,
      detail: `${inventory.resourceGroups.length} resource groups · ${inventory.virtualMachines.length} VMs`,
      durationMs,
    });
    return true;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const code = normalizeErrorCode(error);
    entry.runs += 1;
    entry.failures += 1;
    entry.lastOutcome = "failure";
    entry.lastRunAt = new Date().toISOString();
    entry.nextRunDueAt = Date.now() + entry.intervalMs;
    recordHealthSample({
      connectionId,
      source: "scheduled-refresh",
      ok: false,
      status: code,
      latencyMs: durationMs,
      message: error instanceof Error ? error.message : null,
    });
    recordCloudAudit({
      action: "connection.scheduled-refresh",
      outcome: "failure",
      actor: SYSTEM_ACTOR,
      connectionId,
      connectionName: connection.name,
      subscriptionId: connection.subscriptionId,
      errorCode: code,
      detail: error instanceof Error ? error.message.slice(0, 300) : null,
      durationMs,
    });
    return false;
  } finally {
    inFlight.delete(connectionId);
  }
}

async function tick() {
  lastTickAt = new Date().toISOString();
  const now = Date.now();
  // Disconnected connections are skipped; a failing one is retried next cycle.
  const targets = listConnections().filter((c) => c.status !== "DISCONNECTED");
  for (const connection of targets) {
    const entry = entryFor(connection.id);
    if (entry.paused || now < entry.nextRunDueAt) continue;
    await refreshConnectionOnSchedule(connection.id);
  }
}

/** Idempotent: safe to call from every request handler. */
export function ensureRefreshScheduler(): ScheduleState {
  if (!started) {
    started = true;
    const configured = configuredInterval();
    defaultPaused = configured === 0;
    defaultInterval = configured || DEFAULT_INTERVAL;
    timer = setInterval(() => {
      void tick();
    }, TICK_MS);
    // Never hold the worker open for the timer alone.
    (timer as unknown as { unref?: () => void }).unref?.();
  }
  return schedulerState();
}

/** Aggregate view kept for callers that only need "is auto refresh on". */
export function schedulerState(): ScheduleState {
  const all = [...entries.values()];
  const active = all.filter((e) => !e.paused);
  const nextDue = active.length ? Math.min(...active.map((e) => e.nextRunDueAt)) : null;
  const lastRuns = all.map((e) => e.lastRunAt).filter((v): v is string => Boolean(v)).sort();
  return {
    enabled: timer !== null && (all.length === 0 ? !defaultPaused : active.length > 0),
    intervalMs: active.length ? Math.min(...active.map((e) => e.intervalMs)) : defaultInterval,
    nextRunAt: nextDue ? new Date(nextDue).toISOString() : null,
    lastRunAt: lastRuns[lastRuns.length - 1] ?? lastTickAt,
    running: inFlight.size > 0,
    runs: all.reduce((sum, e) => sum + e.runs, 0),
    failures: all.reduce((sum, e) => sum + e.failures, 0),
  };
}

/* ------------------------------------------------ per-connection controls -- */

export function getConnectionSchedule(connectionId: string): ConnectionSchedule {
  return toSchedule(connectionId, entryFor(connectionId));
}

export function listConnectionSchedules(): ConnectionSchedule[] {
  return listConnections().map((c) => getConnectionSchedule(c.id));
}

export function setConnectionSchedule(
  connectionId: string,
  patch: { paused?: boolean; intervalMs?: number },
): ConnectionSchedule {
  const entry = entryFor(connectionId);
  if (typeof patch.intervalMs === "number" && Number.isFinite(patch.intervalMs)) {
    entry.intervalMs = Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, Math.round(patch.intervalMs)));
    entry.nextRunDueAt = Date.now() + entry.intervalMs;
  }
  if (typeof patch.paused === "boolean") {
    entry.paused = patch.paused;
    // Resuming starts a fresh interval rather than firing a backlog burst.
    if (!patch.paused) entry.nextRunDueAt = Date.now() + entry.intervalMs;
  }
  return toSchedule(connectionId, entry);
}

export function forgetConnectionSchedule(connectionId: string) {
  entries.delete(connectionId);
}

/** Run every unpaused connection now, outside the timer. */
export async function refreshAllNow(): Promise<void> {
  for (const connection of listConnections()) {
    if (entryFor(connection.id).paused) continue;
    await refreshConnectionOnSchedule(connection.id);
  }
}
