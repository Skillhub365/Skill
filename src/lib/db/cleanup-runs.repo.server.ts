import { db } from "./client.server";

/**
 * Durable, lease-coordinated cleanup runs.
 *
 * A partial unique index on `job WHERE status = 'running'` means exactly one
 * instance can hold a job lease at a time, so the reaper is safe to schedule
 * on every app instance. A crashed worker's lease is reclaimed once it
 * expires, and every pass leaves a durable record of what it reclaimed.
 */

export interface CleanupLease {
  id: string;
  job: string;
  workerId: string;
}

export interface CleanupRunRecord {
  id: string;
  job: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  reclaimed: number;
  failures: number;
  detail: string | null;
  metadata: Record<string, unknown>;
}

const WORKER_ID = `worker-${Math.random().toString(16).slice(2, 10)}`;

export function workerId() {
  return WORKER_ID;
}

/** Expire leases whose holder died before finishing. */
async function reclaimExpiredLeases(job: string) {
  const supabase = await db();
  await supabase
    .from("cleanup_runs")
    .update({
      status: "abandoned",
      finished_at: new Date().toISOString(),
      detail: "Lease expired before the worker reported completion.",
    } as never)
    .eq("job", job)
    .eq("status", "running")
    .lt("lease_until", new Date().toISOString());
}

/**
 * Try to take the lease for `job`. Returns null when another instance already
 * holds it — the caller should simply skip this pass.
 */
export async function acquireCleanupLease(job: string, leaseMs = 120_000): Promise<CleanupLease | null> {
  try {
    await reclaimExpiredLeases(job);
    const supabase = await db();
    const { data, error } = await supabase
      .from("cleanup_runs")
      .insert({
        job,
        worker_id: WORKER_ID,
        status: "running",
        lease_until: new Date(Date.now() + leaseMs).toISOString(),
      } as never)
      .select("id, job, worker_id")
      .single();
    // Unique-violation means a live lease exists on another instance.
    if (error || !data) return null;
    return { id: String(data.id), job, workerId: WORKER_ID };
  } catch {
    return null;
  }
}

export async function completeCleanupRun(
  lease: CleanupLease,
  result: { reclaimed: number; failures: number; detail?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const supabase = await db();
    await supabase
      .from("cleanup_runs")
      .update({
        status: result.failures > 0 ? "completed_with_errors" : "completed",
        finished_at: new Date().toISOString(),
        reclaimed: result.reclaimed,
        failures: result.failures,
        detail: result.detail ?? null,
        metadata: (result.metadata ?? {}) as never,
      } as never)
      .eq("id", lease.id);
  } catch (error) {
    console.error("[cleanup] run completion failed", (error as Error)?.message);
  }
}

export async function failCleanupRun(lease: CleanupLease, detail: string): Promise<void> {
  try {
    const supabase = await db();
    await supabase
      .from("cleanup_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), detail } as never)
      .eq("id", lease.id);
  } catch {
    /* the lease still expires on its own */
  }
}

export async function listCleanupRuns(job: string, limit = 20): Promise<CleanupRunRecord[]> {
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("cleanup_runs")
      .select("*")
      .eq("job", job)
      .order("started_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r["id"]),
        job: String(r["job"]),
        status: String(r["status"]),
        startedAt: String(r["started_at"]),
        finishedAt: (r["finished_at"] as string | null) ?? null,
        reclaimed: Number(r["reclaimed"] ?? 0),
        failures: Number(r["failures"] ?? 0),
        detail: (r["detail"] as string | null) ?? null,
        metadata: (r["metadata"] as Record<string, unknown>) ?? {},
      };
    });
  } catch {
    return [];
  }
}
