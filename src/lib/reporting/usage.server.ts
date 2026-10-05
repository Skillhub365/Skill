import { db } from "@/lib/db/client.server";
import { estimateCostCents, hourlyRateCents, PRICING_SOURCE, rateCard } from "@/lib/cost/pricing";

/**
 * Usage and cost reporting.
 *
 * Everything here is derived from durable session rows: a session's billable
 * span is `started_at -> coalesce(ended_at, now())`, priced with the estimated
 * rate captured on the session (or the current rate card when a legacy row has
 * none). Figures are ESTIMATES — Azure billing is not integrated.
 */

export interface UsageBucket {
  key: string;
  label: string;
  sessions: number;
  vmHours: number;
  estimatedCostCents: number;
}

export interface UsageReport {
  windowDays: number;
  from: string;
  to: string;
  pricingSource: typeof PRICING_SOURCE;
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
  byTenant: UsageBucket[];
  byWorkspace: UsageBucket[];
  byLab: UsageBucket[];
  byUser: UsageBucket[];
  bySize: UsageBucket[];
  /** Session-based versus persistent (multi-day) consumption. */
  byMode: UsageBucket[];
  peakConcurrentSessions: { count: number; at: string | null };
  rateCard: ReturnType<typeof rateCard>;
}

interface UsageRow {
  id: string;
  tenant_id: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  lab_id: string | null;
  lab_title: string | null;
  user_id: string;
  user_name: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  vm_size: string | null;
  hourly_rate_cents: number | null;
  lab_mode?: string | null;
  billable_minutes?: number | null;
}

const LIVE = ["REQUESTED", "ALLOCATING", "CREATING", "STARTING", "BOOTING", "READY", "ACTIVE"];

function hoursBetween(from: string, to: number) {
  return Math.max(0, (to - new Date(from).getTime()) / 3_600_000);
}

function add(map: Map<string, UsageBucket>, key: string, label: string, hours: number, cents: number) {
  const bucket = map.get(key) ?? { key, label, sessions: 0, vmHours: 0, estimatedCostCents: 0 };
  bucket.sessions += 1;
  bucket.vmHours += hours;
  bucket.estimatedCostCents += cents;
  map.set(key, bucket);
}

function sorted(map: Map<string, UsageBucket>) {
  return [...map.values()]
    .map((bucket) => ({ ...bucket, vmHours: Number(bucket.vmHours.toFixed(2)) }))
    .sort((a, b) => b.estimatedCostCents - a.estimatedCostCents)
    .slice(0, 50);
}

/** Highest number of sessions live at the same moment inside the window. */
function peakConcurrency(rows: UsageRow[], now: number) {
  const points: Array<{ at: number; delta: number }> = [];
  for (const row of rows) {
    points.push({ at: new Date(row.started_at).getTime(), delta: 1 });
    points.push({ at: row.ended_at ? new Date(row.ended_at).getTime() : now, delta: -1 });
  }
  points.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  let peakAt: number | null = null;
  for (const point of points) {
    current += point.delta;
    if (current > peak) {
      peak = current;
      peakAt = point.at;
    }
  }
  return { count: peak, at: peakAt ? new Date(peakAt).toISOString() : null };
}

/**
 * Build the usage report. `tenantId` scopes every figure to one organisation;
 * platform-wide reporting (super admin) passes null.
 */
export async function usageReport(options: { windowDays?: number; tenantId?: string | null } = {}): Promise<UsageReport> {
  const windowDays = options.windowDays ?? 30;
  const now = Date.now();
  const from = new Date(now - windowDays * 86_400_000).toISOString();

  let rows: UsageRow[] = [];
  try {
    const supabase = await db();
    let query = supabase
      .from("sessions")
      .select(
        "id, tenant_id, workspace_id, workspace_name, lab_id, lab_title, user_id, user_name, status, started_at, ended_at, vm_size, hourly_rate_cents, lab_mode, billable_minutes",
      )
      .gte("started_at", from)
      .order("started_at", { ascending: false })
      .limit(10_000);
    if (options.tenantId) query = query.eq("tenant_id", options.tenantId);
    const { data } = await query;
    rows = (data ?? []) as unknown as UsageRow[];
  } catch {
    rows = [];
  }

  const byTenant = new Map<string, UsageBucket>();
  const byWorkspace = new Map<string, UsageBucket>();
  const byLab = new Map<string, UsageBucket>();
  const byUser = new Map<string, UsageBucket>();
  const bySize = new Map<string, UsageBucket>();
  const byMode = new Map<string, UsageBucket>();

  const totals = {
    sessions: rows.length,
    vmHours: 0,
    estimatedCostCents: 0,
    active: 0,
    completed: 0,
    expired: 0,
    stopped: 0,
    failed: 0,
  };

  for (const row of rows) {
    const end = row.ended_at ? new Date(row.ended_at).getTime() : now;
    const hours = hoursBetween(row.started_at, end);
    const rate = row.hourly_rate_cents ?? hourlyRateCents(row.vm_size);
    const cents = row.hourly_rate_cents ? hours * rate : estimateCostCents(row.vm_size, hours);

    totals.vmHours += hours;
    totals.estimatedCostCents += cents;
    if (LIVE.includes(row.status)) totals.active += 1;
    if (row.status === "EXPIRED") totals.expired += 1;
    else if (row.status === "STOPPED") totals.stopped += 1;
    else if (row.status === "ERROR") totals.failed += 1;
    if (row.ended_at) totals.completed += 1;

    add(byTenant, row.tenant_id ?? "unassigned", row.tenant_id ?? "Unassigned", hours, cents);
    add(byWorkspace, row.workspace_id ?? "unassigned", row.workspace_name ?? "Unassigned workspace", hours, cents);
    add(byLab, row.lab_id ?? "unassigned", row.lab_title ?? "Unassigned lab", hours, cents);
    // Learner attribution uses the display name already stored on the session.
    add(byUser, row.user_id, row.user_name ?? "Learner", hours, cents);
    add(bySize, row.vm_size ?? "unknown", row.vm_size ?? "Unknown size", hours, cents);
    const mode = row.lab_mode === "persistent" ? "persistent" : "session_based";
    add(byMode, mode, mode === "persistent" ? "Persistent (multi-day) labs" : "Session-based labs", hours, cents);
  }

  return {
    windowDays,
    from,
    to: new Date(now).toISOString(),
    pricingSource: PRICING_SOURCE,
    totals: {
      ...totals,
      vmHours: Number(totals.vmHours.toFixed(2)),
      estimatedCostCents: Math.round(totals.estimatedCostCents),
    },
    byTenant: sorted(byTenant),
    byWorkspace: sorted(byWorkspace),
    byLab: sorted(byLab),
    byUser: sorted(byUser),
    bySize: sorted(bySize),
    byMode: sorted(byMode),
    peakConcurrentSessions: peakConcurrency(rows, now),
    rateCard: rateCard(),
  };
}

/** Machine hours consumed this calendar month, used by the budget guard. */
export async function monthToDateUsage(scope: { tenantId?: string | null; workspaceId?: string | null }): Promise<{
  vmHours: number;
  estimatedCostCents: number;
}> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const now = Date.now();
  try {
    const supabase = await db();
    let query = supabase
      .from("sessions")
      .select("started_at, ended_at, vm_size, hourly_rate_cents")
      .gte("started_at", start.toISOString())
      .limit(10_000);
    if (scope.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
    else if (scope.tenantId) query = query.eq("tenant_id", scope.tenantId);
    const { data } = await query;
    let vmHours = 0;
    let cents = 0;
    for (const row of (data ?? []) as unknown as UsageRow[]) {
      const end = row.ended_at ? new Date(row.ended_at).getTime() : now;
      const hours = hoursBetween(row.started_at, end);
      vmHours += hours;
      cents += row.hourly_rate_cents ? hours * row.hourly_rate_cents : estimateCostCents(row.vm_size, hours);
    }
    return { vmHours: Number(vmHours.toFixed(2)), estimatedCostCents: Math.round(cents) };
  } catch {
    return { vmHours: 0, estimatedCostCents: 0 };
  }
}
