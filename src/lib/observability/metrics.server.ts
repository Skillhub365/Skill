/**
 * Metric collection points.
 *
 * Two layers, both cheap:
 *   - an in-process counter set for "right now" numbers in the admin console
 *     and the alert evaluator (survives only as long as the worker);
 *   - a durable `metric_events` row per observation, which is what rollups,
 *     usage reports and trend views read.
 *
 * Recording is fire-and-forget: a metric failure never fails the operation it
 * measures, and no dimension may contain a secret or a private IP.
 */

import { insertMetricEvent, rollupMetrics, type MetricEventInput, type MetricRollup } from "@/lib/db/metrics.repo.server";

export const METRIC = {
  launchRequested: "lab.launch.requested",
  launchSucceeded: "lab.launch.succeeded",
  launchFailed: "lab.launch.failed",
  launchReused: "lab.launch.reused",
  vmAllocationMs: "vm.allocation.duration_ms",
  vmStartMs: "vm.start.duration_ms",
  vmReadyMs: "vm.readiness.duration_ms",
  vmReadinessTimeout: "vm.readiness.timeout",
  sessionActive: "session.active",
  sessionExpired: "session.expired",
  sessionAbandoned: "session.abandoned",
  sessionStopped: "session.stopped",
  sessionExtended: "session.extended",
  orphanDetected: "vm.orphan.detected",
  orphanReclaimed: "vm.orphan.reclaimed",
  gatewayConnectSucceeded: "gateway.connect.succeeded",
  gatewayConnectFailed: "gateway.connect.failed",
  azureApiFailure: "azure.api.failure",
  keyVaultFailure: "keyvault.failure",
  authFailure: "auth.failure",
  authorizationDenied: "authz.denied",
  quotaDenied: "quota.denied",
  cleanupFailure: "cleanup.failure",
  cleanupRun: "cleanup.run",
  mcpToolSucceeded: "mcp.tool.succeeded",
  mcpToolFailed: "mcp.tool.failed",
  mcpToolDurationMs: "mcp.tool.duration_ms",
} as const;

export type MetricName = (typeof METRIC)[keyof typeof METRIC];

interface Counters {
  counts: Record<string, number>;
  since: string;
}

const KEY = "__skilltrack_metric_counters__";

function counters(): Counters {
  const g = globalThis as unknown as Record<string, Counters | undefined>;
  if (!g[KEY]) g[KEY] = { counts: {}, since: new Date().toISOString() };
  return g[KEY]!;
}

/** Snapshot of this worker's counters — cheap, no database round trip. */
export function counterSnapshot(): Counters {
  const c = counters();
  return { counts: { ...c.counts }, since: c.since };
}

export function resetCounters() {
  const c = counters();
  c.counts = {};
  c.since = new Date().toISOString();
}

export interface MetricDimensions extends Omit<MetricEventInput, "metric" | "value" | "unit"> {}

/** Record one observation. Never throws, never awaits the caller's critical path. */
export function recordMetric(metric: MetricName | string, value = 1, dimensions: MetricDimensions = {}): void {
  const c = counters();
  c.counts[metric] = (c.counts[metric] ?? 0) + (Number.isFinite(value) ? value : 0);
  void insertMetricEvent({ metric, value, ...dimensions }).catch(() => null);
}

export function recordDuration(metric: MetricName | string, ms: number, dimensions: MetricDimensions = {}): void {
  const c = counters();
  const key = `${metric}.count`;
  c.counts[key] = (c.counts[key] ?? 0) + 1;
  void insertMetricEvent({ metric, value: Math.max(0, Math.round(ms)), unit: "ms", ...dimensions }).catch(() => null);
}

/** Time an async operation and record its duration plus outcome. */
export async function timed<T>(
  metric: MetricName | string,
  dimensions: MetricDimensions,
  operation: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    recordDuration(metric, Date.now() - started, { ...dimensions, outcome: "success" });
    return result;
  } catch (error) {
    recordDuration(metric, Date.now() - started, { ...dimensions, outcome: "failure" });
    throw error;
  }
}

export type { MetricRollup };
export { rollupMetrics };
