/**
 * Live operational snapshot for the admin Operations console.
 *
 * Alerts (see alerts.server.ts) summarise metric rollups over a window; this
 * answers the different question an operator asks during a pilot: "what is
 * happening right now, and is anything stuck?". Everything is read straight
 * from durable state so any worker returns the same answer.
 *
 * Server-only. Contains no addresses, tokens or credentials.
 */

import { db } from "@/lib/db/client.server";

/** Statuses that mean a session is consuming (or waiting on) a machine. */
const LIVE = ["REQUESTED", "ALLOCATING", "CREATING", "STARTING", "BOOTING", "READY", "ACTIVE"];
/** Statuses a launch should pass through quickly; lingering here is stuck. */
const LAUNCHING = ["REQUESTED", "ALLOCATING", "CREATING", "STARTING", "BOOTING"];

export interface OperationalItem {
  id: string;
  label: string;
  detail: string;
}

export type OperationalSeverity = "ok" | "warning" | "critical";

export interface OperationalCounter {
  key: string;
  label: string;
  value: number;
  severity: OperationalSeverity;
  detail: string;
  items: OperationalItem[];
}

export interface OperationalSnapshot {
  generatedAt: string;
  degraded: boolean;
  counters: OperationalCounter[];
  reaper: {
    enabled: boolean;
    lastRunAt: string | null;
    status: string | null;
    failures: number;
    reclaimed: number;
    stale: boolean;
    detail: string;
  };
  capacity: {
    total: number;
    available: number;
    inUse: number;
    error: number;
    severity: OperationalSeverity;
    detail: string;
  };
  budget: {
    monthlyBudgetUsd: number | null;
    estimatedSpendUsd: number;
    projectedSpendUsd: number;
    percentUsed: number | null;
    severity: OperationalSeverity;
    detail: string;
  };
}

function num(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function minutesSince(at: string | null | undefined, now: number): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? (now - t) / 60_000 : null;
}

export async function operationalSnapshot(): Promise<OperationalSnapshot> {
  const now = Date.now();
  const stuckAfterMinutes = num("OPS_STUCK_LAUNCH_MINUTES", 15) ?? 15;
  const lowCapacityRatio = num("OPS_LOW_CAPACITY_RATIO", 0.2) ?? 0.2;
  const monthlyBudgetUsd = num("MONTHLY_BUDGET_USD", null);

  const counters: OperationalCounter[] = [];
  const push = (
    key: string,
    label: string,
    value: number,
    severity: OperationalSeverity,
    detail: string,
    items: OperationalItem[] = [],
  ) => counters.push({ key, label, value, severity, detail, items });

  let supabase: Awaited<ReturnType<typeof db>> | null = null;
  try {
    supabase = await db();
  } catch {
    supabase = null;
  }

  /* --------------------------------------------------------- sessions */
  let active = 0;
  const stuck: OperationalItem[] = [];
  let failedLaunches = 0;
  const gatewayFailures: OperationalItem[] = [];

  if (supabase) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, status, started_at, user_name, lab_title, vm_name, ended_reason, ended_at")
      .in("status", LIVE)
      .limit(500);
    for (const s of (sessions ?? []) as Array<Record<string, unknown>>) {
      active += 1;
      const status = String(s["status"]);
      const age = minutesSince(s["started_at"] as string, now);
      if (LAUNCHING.includes(status) && age !== null && age > stuckAfterMinutes) {
        stuck.push({
          id: String(s["id"]),
          label: `${String(s["user_name"] ?? "Learner")} — ${String(s["lab_title"] ?? "lab")}`,
          detail: `Stuck in ${status} for ${Math.round(age)} minutes.`,
        });
      }
    }

    const since = new Date(now - 86_400_000).toISOString();
    const { data: failures } = await supabase
      .from("sessions")
      .select("id, status, ended_reason, user_name, lab_title, ended_at")
      .eq("status", "ERROR")
      .gte("started_at", since)
      .limit(200);
    failedLaunches = (failures ?? []).length;

    const { data: gateways } = await supabase
      .from("gateway_connections")
      .select("session_id, status, updated_at, metadata")
      .in("status", ["ERROR"])
      .gte("updated_at", since)
      .limit(200);
    for (const g of (gateways ?? []) as Array<Record<string, unknown>>) {
      gatewayFailures.push({
        id: String(g["session_id"]),
        label: `Session ${String(g["session_id"]).slice(0, 8)}`,
        detail: `Gateway reported ${String(g["status"])} at ${String(g["updated_at"] ?? "")}.`,
      });
    }
  }

  push("active-sessions", "Active sessions", active, "ok", `${active} learner session(s) currently running.`);
  push(
    "stuck-sessions",
    "Stuck sessions",
    stuck.length,
    stuck.length ? "critical" : "ok",
    stuck.length
      ? `${stuck.length} session(s) have not reached a desktop within ${stuckAfterMinutes} minutes.`
      : "No sessions are stuck mid-launch.",
    stuck.slice(0, 20),
  );
  push(
    "failed-launches",
    "Failed launches (24h)",
    failedLaunches,
    failedLaunches > 0 ? "warning" : "ok",
    failedLaunches ? `${failedLaunches} lab start(s) ended in an error.` : "No failed lab starts in the last 24 hours.",
  );
  push(
    "gateway-failures",
    "Gateway failures (24h)",
    gatewayFailures.length,
    gatewayFailures.length > 0 ? "warning" : "ok",
    gatewayFailures.length
      ? `${gatewayFailures.length} desktop connection(s) failed to broker.`
      : "All desktop connections brokered successfully.",
    gatewayFailures.slice(0, 20),
  );

  /* ------------------------------------------------------------- pool */
  let total = 0;
  let available = 0;
  let inUse = 0;
  let errored = 0;
  const orphans: OperationalItem[] = [];

  if (supabase) {
    const { data: vms } = await supabase
      .from("vm_pool_entries")
      .select("id, name, status, orphaned, azure_missing, drift_detected, drift_detail, current_session_id, mock")
      .limit(1000);
    for (const vm of (vms ?? []) as Array<Record<string, unknown>>) {
      total += 1;
      const status = String(vm["status"] ?? "");
      if (status === "AVAILABLE" || status === "STOPPED" || status === "READY") available += 1;
      else if (status === "IN_USE" || status === "ALLOCATED" || status === "RUNNING") inUse += 1;
      if (status === "ERROR") errored += 1;
      if (vm["orphaned"] || vm["azure_missing"] || vm["drift_detected"]) {
        orphans.push({
          id: String(vm["id"]),
          label: String(vm["name"] ?? "Machine"),
          detail: vm["azure_missing"]
            ? "Azure no longer returns this resource."
            : vm["orphaned"]
              ? "Running in Azure with no active session."
              : (vm["drift_detail"] as string | null) ?? "Azure and SkillTrack disagree about this machine.",
        });
      }
    }
  }

  push(
    "orphan-vms",
    "Orphan / drifted machines",
    orphans.length,
    orphans.length ? "warning" : "ok",
    orphans.length ? `${orphans.length} machine(s) need operator attention.` : "No orphaned or drifted machines.",
    orphans.slice(0, 20),
  );

  const ratio = total > 0 ? available / total : 0;
  const capacitySeverity: OperationalSeverity =
    total === 0 ? "critical" : available === 0 ? "critical" : ratio < lowCapacityRatio ? "warning" : "ok";

  /* ----------------------------------------------------------- budget */
  let estimatedSpendCents = 0;
  if (supabase) {
    const monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)).toISOString();
    try {
      const { sessionUsage } = await import("@/lib/reporting/usage-detail.server");
      const usage = await sessionUsage({ from: monthStart, to: new Date(now).toISOString(), limit: 5000 });
      estimatedSpendCents = usage.totals.estimatedCostCents;
    } catch {
      estimatedSpendCents = 0;
    }
  }
  const spendUsd = estimatedSpendCents / 100;
  const dayOfMonth = new Date(now).getUTCDate();
  const daysInMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 0)).getUTCDate();
  const projected = dayOfMonth > 0 ? (spendUsd / dayOfMonth) * daysInMonth : spendUsd;
  const percentUsed = monthlyBudgetUsd ? (spendUsd / monthlyBudgetUsd) * 100 : null;
  const budgetSeverity: OperationalSeverity =
    percentUsed == null ? "ok" : percentUsed >= 100 ? "critical" : percentUsed >= 80 ? "warning" : "ok";

  /* ----------------------------------------------------------- reaper */
  const reaperEnabled = (process.env["DISABLE_SESSION_REAPER"] ?? "").toLowerCase() !== "true";
  let lastRunAt: string | null = null;
  let reaperStatus: string | null = null;
  let reaperFailures = 0;
  let reclaimed = 0;
  if (supabase) {
    const { data } = await supabase
      .from("cleanup_runs")
      .select("status, finished_at, failures, reclaimed")
      .order("started_at", { ascending: false })
      .limit(1);
    const run = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (run) {
      lastRunAt = (run["finished_at"] as string | null) ?? null;
      reaperStatus = String(run["status"] ?? "");
      reaperFailures = Number(run["failures"] ?? 0);
      reclaimed = Number(run["reclaimed"] ?? 0);
    }
  }
  const reaperAge = minutesSince(lastRunAt, now);
  const reaperStale = !lastRunAt || (reaperAge ?? Infinity) > 15;

  const degraded =
    counters.some((c) => c.severity === "critical") ||
    capacitySeverity === "critical" ||
    budgetSeverity === "critical" ||
    (reaperEnabled && reaperStale);

  return {
    generatedAt: new Date(now).toISOString(),
    degraded,
    counters,
    reaper: {
      enabled: reaperEnabled,
      lastRunAt,
      status: reaperStatus,
      failures: reaperFailures,
      reclaimed,
      stale: reaperStale,
      detail: !reaperEnabled
        ? "The reaper is disabled; expired sessions and orphans will not be reclaimed."
        : lastRunAt
          ? `Last sweep ${Math.round(reaperAge ?? 0)} minute(s) ago — ${reaperStatus}, ${reaperFailures} failure(s), ${reclaimed} reclaimed.`
          : "The reaper has not recorded a sweep yet.",
    },
    capacity: {
      total,
      available,
      inUse,
      error: errored,
      severity: capacitySeverity,
      detail:
        total === 0
          ? "No machines are registered in the pool."
          : `${available} of ${total} machine(s) are free (${Math.round(ratio * 100)}%); ${inUse} in use, ${errored} in error.`,
    },
    budget: {
      monthlyBudgetUsd,
      estimatedSpendUsd: Number(spendUsd.toFixed(2)),
      projectedSpendUsd: Number(projected.toFixed(2)),
      percentUsed: percentUsed == null ? null : Number(percentUsed.toFixed(1)),
      severity: budgetSeverity,
      detail: monthlyBudgetUsd
        ? `$${spendUsd.toFixed(2)} of a $${monthlyBudgetUsd.toFixed(0)} budget used this month; projected $${projected.toFixed(2)}.`
        : `$${spendUsd.toFixed(2)} estimated this month. Set MONTHLY_BUDGET_USD to enable budget warnings.`,
    },
  };
}
