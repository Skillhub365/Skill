/** Browser client for the operations console. Read-only, admin endpoints. */

import { ApiError } from "@/lib/errors";
import { authHeaders } from "@/lib/security/token-store";
import type { SecurityErrorCode } from "@/lib/security/types";

export interface MetricRollupView {
  metric: string;
  count: number;
  total: number;
  average: number;
  p95: number | null;
  failures: number;
}

export interface AlertView {
  id: string;
  title: string;
  severity: "critical" | "warning" | "info";
  state: "firing" | "ok";
  detail: string;
  action: string;
  observed: number;
  threshold: number;
}

export interface CleanupRunView {
  at: string;
  expiredSessions: number;
  releasedVms: number;
  orphans: number;
  stuckLaunches?: number;
  staleAllocations?: number;
  errors: string[];
}

export interface OpsStatus {
  generatedAt: string;
  windowHours: number;
  health: unknown;
  metrics: MetricRollupView[];
  counters: { counts: Record<string, number>; since: string };
  alerts: AlertView[];
  lastCleanupRun: CleanupRunView | null;
}

export interface UsageBucketView {
  key: string;
  label: string;
  sessions: number;
  vmHours: number;
  estimatedCostCents: number;
}

export interface UsageReportView {
  windowDays: number;
  from: string;
  to: string;
  pricingSource: string;
  totals: {
    sessions: number;
    vmHours: number;
    estimatedCostCents: number;
    active: number;
    completed: number;
    expired: number;
    stopped: number;
    failed: number;
  };
  byTenant: UsageBucketView[];
  byWorkspace: UsageBucketView[];
  byLab: UsageBucketView[];
  byUser: UsageBucketView[];
  bySize: UsageBucketView[];
  peakConcurrentSessions: { count: number; at: string | null };
  rateCard: Array<{ size: string; hourlyRateCents: number }>;
}

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { code?: SecurityErrorCode; detail?: string };
  if (!res.ok) throw new ApiError((data.code as SecurityErrorCode) ?? "UNKNOWN", data.detail, res.status);
  return data;
}

export async function fetchOpsStatus(windowHours = 24) {
  return unwrap<OpsStatus>(
    await fetch(`/api/admin/ops-status?windowHours=${windowHours}`, { headers: authHeaders() }),
  );
}

export async function fetchUsageReport(windowDays = 30) {
  return unwrap<UsageReportView>(
    await fetch(`/api/admin/usage-report?windowDays=${windowDays}`, { headers: authHeaders() }),
  );
}

/** Trigger a CSV download of the same figures the report shows. */
export async function downloadUsageCsv(windowDays = 30) {
  const res = await fetch(`/api/admin/usage-report?windowDays=${windowDays}&format=csv`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("UNKNOWN", "The export could not be generated.", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `skilltrack-usage-${windowDays}d.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const METRIC_LABEL: Record<string, string> = {
  "lab.launch.requested": "Lab starts requested",
  "lab.launch.succeeded": "Lab starts succeeded",
  "lab.launch.failed": "Lab starts failed",
  "lab.launch.reused": "Lab starts reused (retry)",
  "vm.allocation.duration_ms": "Machine allocation time",
  "vm.start.duration_ms": "Machine start time",
  "vm.readiness.duration_ms": "Time to ready desktop",
  "vm.readiness.timeout": "Readiness timeouts",
  "session.expired": "Sessions expired",
  "session.stopped": "Sessions stopped",
  "session.extended": "Session extensions (minutes)",
  "session.abandoned": "Sessions abandoned",
  "vm.orphan.detected": "Orphaned machines detected",
  "vm.orphan.reclaimed": "Orphaned machines reclaimed",
  "gateway.connect.succeeded": "Desktop connections succeeded",
  "gateway.connect.failed": "Desktop connections failed",
  "azure.api.failure": "Cloud API failures",
  "keyvault.failure": "Secret store failures",
  "auth.failure": "Sign-in failures",
  "authz.denied": "Access denials",
  "quota.denied": "Blocked by limits",
  "cleanup.failure": "Cleanup failures",
  "cleanup.run": "Cleanup runs",
};

export function metricLabel(metric: string) {
  return METRIC_LABEL[metric] ?? metric;
}

export function isDurationMetric(metric: string) {
  return metric.endsWith("_ms");
}
