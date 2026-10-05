/**
 * Connection health diagnostics.
 *
 * Every test, manual refresh and scheduled refresh appends a sample so an
 * administrator can see whether a subscription is intermittently failing
 * rather than only the latest outcome. Samples are capped per connection and
 * live in the server process alongside the registry.
 */

import type { ConnectionHealth, HealthSample, HealthSource, RecurringFailure } from "./health-types";

const MAX_SAMPLES = 100;
const samples = new Map<string, HealthSample[]>();

export interface HealthInput {
  connectionId: string;
  source: HealthSource;
  ok: boolean;
  status: string;
  latencyMs?: number;
  message?: string | null;
}

export function recordHealthSample(input: HealthInput): HealthSample {
  const sample: HealthSample = {
    id: `health-${crypto.randomUUID().slice(0, 10)}`,
    connectionId: input.connectionId,
    at: new Date().toISOString(),
    source: input.source,
    ok: input.ok,
    status: input.status,
    latencyMs: Math.max(0, Math.round(input.latencyMs ?? 0)),
    message: input.message ? input.message.slice(0, 300) : null,
  };
  const list = samples.get(input.connectionId) ?? [];
  list.unshift(sample);
  if (list.length > MAX_SAMPLES) list.length = MAX_SAMPLES;
  samples.set(input.connectionId, list);
  return sample;
}

export function clearHealth(connectionId: string) {
  samples.delete(connectionId);
}

function recurringFrom(list: HealthSample[]): RecurringFailure[] {
  const byStatus = new Map<string, RecurringFailure>();
  for (const sample of list) {
    if (sample.ok) continue;
    const existing = byStatus.get(sample.status);
    if (existing) {
      existing.count += 1;
      // list is newest-first, so later iterations are older.
      existing.firstSeen = sample.at;
    } else {
      byStatus.set(sample.status, { status: sample.status, count: 1, firstSeen: sample.at, lastSeen: sample.at });
    }
  }
  return [...byStatus.values()].filter((f) => f.count >= 2).sort((a, b) => b.count - a.count);
}

export function connectionHealth(connectionId: string, connectionName = connectionId): ConnectionHealth {
  const list = samples.get(connectionId) ?? [];
  const failures = list.filter((s) => !s.ok).length;
  let consecutive = 0;
  for (const sample of list) {
    if (sample.ok) break;
    consecutive += 1;
  }
  const successRate = list.length ? Math.round(((list.length - failures) / list.length) * 100) : 0;
  const averageLatencyMs = list.length
    ? Math.round(list.reduce((sum, s) => sum + s.latencyMs, 0) / list.length)
    : 0;
  const verdict: ConnectionHealth["verdict"] = !list.length
    ? "unknown"
    : consecutive >= 2 || successRate < 60
      ? "failing"
      : failures > 0
        ? "degraded"
        : "healthy";

  return {
    connectionId,
    connectionName,
    samples: list,
    total: list.length,
    failures,
    successRate,
    consecutiveFailures: consecutive,
    averageLatencyMs,
    lastOkAt: list.find((s) => s.ok)?.at ?? null,
    lastFailureAt: list.find((s) => !s.ok)?.at ?? null,
    lastStatus: list[0]?.status ?? null,
    recurring: recurringFrom(list),
    verdict,
  };
}
