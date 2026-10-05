import { db } from "./client.server";

/**
 * Durable metric events.
 *
 * There is no external metrics backend in this deployment, so counters and
 * timings are persisted as rows and rolled up on demand for the admin console
 * and the alert evaluator.
 *
 * TODO(monitoring): ship these to Azure Monitor / Log Analytics via a
 * scheduled exporter and retire the in-database rollups once a real
 * time-series backend is available.
 */

export interface MetricEventInput {
  metric: string;
  value?: number;
  unit?: "count" | "ms" | "hours" | "cents";
  outcome?: "success" | "failure" | null;
  tenantId?: string | null;
  workspaceId?: string | null;
  labId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  vmId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MetricRollup {
  metric: string;
  count: number;
  total: number;
  average: number;
  p95: number | null;
  failures: number;
}

/** Never persist an identifier-shaped value that is really a secret. */
const FORBIDDEN_KEY = /(token|password|secret|credential|authorization|private_?ip|_code$)/i;

function scrub(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return {};
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !FORBIDDEN_KEY.test(key)));
}

function uuidOrNull(value: string | null | undefined): string | null {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export async function insertMetricEvent(input: MetricEventInput): Promise<void> {
  try {
    const supabase = await db();
    await supabase.from("metric_events").insert({
      metric: input.metric,
      value: input.value ?? 1,
      unit: input.unit ?? "count",
      outcome: input.outcome ?? null,
      tenant_id: uuidOrNull(input.tenantId),
      workspace_id: uuidOrNull(input.workspaceId),
      lab_id: uuidOrNull(input.labId),
      user_id: uuidOrNull(input.userId),
      session_id: uuidOrNull(input.sessionId),
      vm_id: input.vmId ?? null,
      correlation_id: input.correlationId ?? null,
      metadata: scrub(input.metadata) as never,
    } as never);
  } catch {
    /* metrics must never break the operation being measured */
  }
}

interface MetricRow {
  metric: string;
  value: number | string;
  outcome: string | null;
}

/** Roll up every metric recorded in the last `windowHours`. */
export async function rollupMetrics(windowHours = 24): Promise<MetricRollup[]> {
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  let rows: MetricRow[] = [];
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("metric_events")
      .select("metric, value, outcome")
      .gte("at", since)
      .order("at", { ascending: false })
      .limit(20_000);
    rows = (data ?? []) as unknown as MetricRow[];
  } catch {
    return [];
  }

  const grouped = new Map<string, number[]>();
  const failures = new Map<string, number>();
  for (const row of rows) {
    const values = grouped.get(row.metric) ?? [];
    values.push(Number(row.value));
    grouped.set(row.metric, values);
    if (row.outcome === "failure") failures.set(row.metric, (failures.get(row.metric) ?? 0) + 1);
  }

  return [...grouped.entries()]
    .map(([metric, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const total = values.reduce((sum, value) => sum + value, 0);
      return {
        metric,
        count: values.length,
        total,
        average: total / values.length,
        p95: sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null) : null,
        failures: failures.get(metric) ?? 0,
      };
    })
    .sort((a, b) => a.metric.localeCompare(b.metric));
}
