import { db } from "@/lib/db/client.server";
import { estimateCostCents, hourlyRateCents, PRICING_SOURCE } from "@/lib/cost/pricing";

/**
 * Session-level usage detail and the unified activity feed behind
 * /admin/usage. Every duration and cost figure here is derived on the server
 * from durable `sessions` timestamps — the browser never computes billing.
 *
 * Cost remains an ESTIMATE (see `@/lib/cost/pricing`). Secrets, private IPs and
 * gateway credentials are never selected or returned.
 */

export interface UsageFilters {
  from?: string | null;
  to?: string | null;
  /** Always forced to the caller's tenant for non-super-admins. */
  tenantId?: string | null;
  workspaceId?: string | null;
  labId?: string | null;
  userId?: string | null;
  /** Matches the Azure VM name or the internal VM id. */
  vm?: string | null;
  status?: string | null;
  limit?: number;
}

export interface SessionUsageRow {
  sessionId: string;
  tenantId: string | null;
  learnerId: string;
  learnerName: string;
  learnerEmail: string | null;
  workspaceId: string | null;
  workspace: string;
  labId: string | null;
  lab: string;
  vmId: string | null;
  vmName: string | null;
  azureResourceId: string | null;
  vmSize: string | null;
  region: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  billableHours: number;
  status: string;
  live: boolean;
  estimatedCostCents: number;
  hourlyRateCents: number;
  assignmentType: "session-based" | "persistent";
  /** Minutes charged to a persistent allowance (null for session-based labs). */
  billableMinutes: number | null;
  /** Persistent grants only: hours left in the learner's allowance. */
  persistentRemainingHours: number | null;
  persistentAllowedHours: number | null;
  /** Persistent grants only: when the learner's access window closes. */
  accessEndsAt: string | null;
  correlationId: string | null;
  endedReason: string | null;
}

export interface SessionUsageResult {
  generatedAt: string;
  pricingSource: typeof PRICING_SOURCE;
  from: string;
  to: string;
  rows: SessionUsageRow[];
  totals: {
    sessions: number;
    active: number;
    completed: number;
    expired: number;
    stopped: number;
    failed: number;
    vmHours: number;
    estimatedCostCents: number;
  };
  byVm: UsageDimension[];
  byLearner: UsageDimension[];
  byWorkspace: UsageDimension[];
  byLab: UsageDimension[];
  bySize: UsageDimension[];
  /** Session-based versus persistent (multi-day) consumption. */
  byMode: UsageDimension[];
}

export interface UsageDimension {
  key: string;
  label: string;
  sessions: number;
  vmHours: number;
  estimatedCostCents: number;
}

export const LIVE_STATUSES = [
  "REQUESTED",
  "ALLOCATING",
  "CREATING",
  "STARTING",
  "BOOTING",
  "READY",
  "ACTIVE",
];

/**
 * Azure resource ids embed subscription ids. Keep the operationally useful
 * tail (resource group + VM) and drop the subscription.
 */
export function redactResourceId(resourceId: string | null | undefined): string | null {
  if (!resourceId) return null;
  const rg = /resourceGroups\/([^/]+)/i.exec(resourceId)?.[1];
  const name = resourceId.split("/").filter(Boolean).pop();
  if (rg && name) return `…/resourceGroups/${rg}/…/${name}`;
  return resourceId.length > 48 ? `…${resourceId.slice(-48)}` : resourceId;
}

function windowFrom(filters: UsageFilters) {
  const to = filters.to ? new Date(filters.to) : new Date();
  const from = filters.from ? new Date(filters.from) : new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function bump(map: Map<string, UsageDimension>, key: string, label: string, hours: number, cents: number) {
  const bucket = map.get(key) ?? { key, label, sessions: 0, vmHours: 0, estimatedCostCents: 0 };
  bucket.sessions += 1;
  bucket.vmHours += hours;
  bucket.estimatedCostCents += cents;
  map.set(key, bucket);
}

function finish(map: Map<string, UsageDimension>): UsageDimension[] {
  return [...map.values()]
    .map((b) => ({ ...b, vmHours: Number(b.vmHours.toFixed(2)), estimatedCostCents: Math.round(b.estimatedCostCents) }))
    .sort((a, b) => b.estimatedCostCents - a.estimatedCostCents)
    .slice(0, 100);
}

/** Session-level usage rows, already scoped, filtered and priced. */
export async function sessionUsage(filters: UsageFilters): Promise<SessionUsageResult> {
  const { from, to } = windowFrom(filters);
  const now = Date.now();
  const limit = Math.min(5_000, Math.max(1, filters.limit ?? 1_000));

  let rows: Array<Record<string, unknown>> = [];
  try {
    const supabase = await db();
    let query = supabase
      .from("sessions")
      .select(
        "id, tenant_id, workspace_id, workspace_name, lab_id, lab_title, user_id, user_name, vm_id, vm_name, vm_size, status, started_at, ended_at, ended_reason, correlation_id, hourly_rate_cents, duration_minutes, extended_minutes, lab_mode, billable_minutes",
      )
      .gte("started_at", from)
      .lte("started_at", to)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (filters.tenantId) query = query.eq("tenant_id", filters.tenantId);
    if (filters.workspaceId) query = query.eq("workspace_id", filters.workspaceId);
    if (filters.labId) query = query.eq("lab_id", filters.labId);
    if (filters.userId) query = query.eq("user_id", filters.userId);
    if (filters.status) query = query.eq("status", filters.status);
    const { data } = await query;
    rows = (data ?? []) as Array<Record<string, unknown>>;
  } catch {
    rows = [];
  }

  // Enrich with Azure placement details the session row does not carry.
  const vmNames = [...new Set(rows.map((r) => String(r["vm_name"] ?? "")).filter(Boolean))];
  const placement = new Map<string, { azureResourceId: string | null; region: string | null; vmSize: string | null }>();
  if (vmNames.length) {
    try {
      const supabase = await db();
      const { data } = await supabase
        .from("vm_pool_entries")
        .select("azure_vm_name, name, azure_resource_id, region, vm_size")
        .in("azure_vm_name", vmNames.slice(0, 500));
      for (const entry of (data ?? []) as Array<Record<string, unknown>>) {
        const key = String(entry["azure_vm_name"] ?? entry["name"] ?? "");
        if (!key) continue;
        placement.set(key, {
          azureResourceId: redactResourceId(entry["azure_resource_id"] as string | null),
          region: (entry["region"] as string | null) ?? null,
          vmSize: (entry["vm_size"] as string | null) ?? null,
        });
      }
    } catch {
      /* placement enrichment is best-effort */
    }
  }

  // Learner email comes from profiles; never from anything client-supplied.
  const userIds = [...new Set(rows.map((r) => String(r["user_id"] ?? "")).filter(Boolean))];
  const emails = new Map<string, string>();
  if (userIds.length) {
    try {
      const supabase = await db();
      const { data } = await supabase.from("profiles").select("id, email, full_name").in("id", userIds.slice(0, 500));
      for (const p of (data ?? []) as Array<Record<string, unknown>>) {
        emails.set(String(p["id"]), String(p["email"] ?? ""));
      }
    } catch {
      /* email enrichment is best-effort */
    }
  }

  // Persistent allowances live on the assignment, not the session, so the
  // report can show how much of a multi-day grant is left.
  const persistentKeys = [
    ...new Set(
      rows
        .filter((r) => r["lab_mode"] === "persistent")
        .map((r) => `${String(r["lab_id"] ?? "")}:${String(r["user_id"] ?? "")}`)
        .filter((k) => k !== ":"),
    ),
  ];
  const grants = new Map<string, { remainingMinutes: number | null; allowedMinutes: number | null; accessEndsAt: string | null }>();
  if (persistentKeys.length) {
    try {
      const supabase = await db();
      const { data } = await supabase
        .from("lab_assignments")
        .select("lab_id, user_id, remaining_minutes, allowed_minutes, used_minutes, access_ends_at")
        .in("lab_id", [...new Set(persistentKeys.map((k) => k.split(":")[0]!))].slice(0, 500));
      for (const a of (data ?? []) as Array<Record<string, unknown>>) {
        const allowed = (a["allowed_minutes"] as number | null) ?? null;
        const remaining =
          (a["remaining_minutes"] as number | null) ??
          (allowed == null ? null : Math.max(0, allowed - Number(a["used_minutes"] ?? 0)));
        grants.set(`${String(a["lab_id"])}:${String(a["user_id"])}`, {
          remainingMinutes: remaining,
          allowedMinutes: allowed,
          accessEndsAt: (a["access_ends_at"] as string | null) ?? null,
        });
      }
    } catch {
      /* allowance enrichment is best-effort */
    }
  }

  const byVm = new Map<string, UsageDimension>();
  const byLearner = new Map<string, UsageDimension>();
  const byWorkspace = new Map<string, UsageDimension>();
  const byLab = new Map<string, UsageDimension>();
  const byMode = new Map<string, UsageDimension>();
  const bySize = new Map<string, UsageDimension>();
  const totals = {
    sessions: 0,
    active: 0,
    completed: 0,
    expired: 0,
    stopped: 0,
    failed: 0,
    vmHours: 0,
    estimatedCostCents: 0,
  };

  const out: SessionUsageRow[] = [];
  for (const row of rows) {
    const vmName = (row["vm_name"] as string | null) ?? null;
    const place = vmName ? placement.get(vmName) : undefined;
    if (filters.vm) {
      const needle = filters.vm.toLowerCase();
      const haystack = `${vmName ?? ""} ${String(row["vm_id"] ?? "")}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }

    const startedAt = String(row["started_at"]);
    const endedAt = (row["ended_at"] as string | null) ?? null;
    const end = endedAt ? new Date(endedAt).getTime() : now;
    // Billable span is server-derived: start -> end, or start -> now while live.
    const hours = Math.max(0, (end - new Date(startedAt).getTime()) / 3_600_000);
    const vmSize = (row["vm_size"] as string | null) ?? place?.vmSize ?? null;
    const rate = (row["hourly_rate_cents"] as number | null) ?? hourlyRateCents(vmSize);
    const cents = row["hourly_rate_cents"] ? hours * rate : estimateCostCents(vmSize, hours);
    const status = String(row["status"] ?? "");
    const live = LIVE_STATUSES.includes(status) && !endedAt;

    totals.sessions += 1;
    totals.vmHours += hours;
    totals.estimatedCostCents += cents;
    if (live) totals.active += 1;
    if (endedAt) totals.completed += 1;
    if (status === "EXPIRED") totals.expired += 1;
    else if (status === "STOPPED") totals.stopped += 1;
    else if (status === "ERROR") totals.failed += 1;

    bump(byVm, vmName ?? "unassigned", vmName ?? "No VM attached", hours, cents);
    bump(
      byLearner,
      String(row["user_id"] ?? "unknown"),
      (row["user_name"] as string | null) ?? emails.get(String(row["user_id"] ?? "")) ?? "Learner",
      hours,
      cents,
    );
    bump(byWorkspace, String(row["workspace_id"] ?? "unassigned"), (row["workspace_name"] as string | null) ?? "Unassigned workspace", hours, cents);
    bump(byLab, String(row["lab_id"] ?? "unassigned"), (row["lab_title"] as string | null) ?? "Unassigned lab", hours, cents);
    bump(bySize, vmSize ?? "unknown", vmSize ?? "Unknown size", hours, cents);
    // Lab mode is recorded on the session itself, so historic rows keep the
    // mode they actually ran under even if the lab is reconfigured later.
    const persistentLab = row["lab_mode"] === "persistent";
    bump(
      byMode,
      persistentLab ? "persistent" : "session_based",
      persistentLab ? "Persistent (multi-day) labs" : "Session-based labs",
      hours,
      cents,
    );

    out.push({
      sessionId: String(row["id"]),
      tenantId: (row["tenant_id"] as string | null) ?? null,
      learnerId: String(row["user_id"] ?? ""),
      learnerName: (row["user_name"] as string | null) ?? "Learner",
      learnerEmail: emails.get(String(row["user_id"] ?? "")) ?? null,
      workspaceId: (row["workspace_id"] as string | null) ?? null,
      workspace: (row["workspace_name"] as string | null) ?? "Unassigned workspace",
      labId: (row["lab_id"] as string | null) ?? null,
      lab: (row["lab_title"] as string | null) ?? "Unassigned lab",
      vmId: (row["vm_id"] as string | null) ?? null,
      vmName,
      azureResourceId: place?.azureResourceId ?? null,
      vmSize,
      region: place?.region ?? null,
      startedAt,
      endedAt,
      durationMinutes: Math.round(hours * 60),
      billableHours: Number(hours.toFixed(3)),
      status,
      live,
      estimatedCostCents: Math.round(cents),
      hourlyRateCents: rate,
      // Pool VMs that outlive the session are persistent capacity; everything
      // else is torn down with the session.
      assignmentType: persistentLab ? "persistent" : "session-based",
      billableMinutes: (row["billable_minutes"] as number | null) ?? null,
      persistentRemainingHours: (() => {
        if (!persistentLab) return null;
        const grant = grants.get(`${String(row["lab_id"] ?? "")}:${String(row["user_id"] ?? "")}`);
        return grant?.remainingMinutes == null ? null : Number((grant.remainingMinutes / 60).toFixed(2));
      })(),
      persistentAllowedHours: (() => {
        if (!persistentLab) return null;
        const grant = grants.get(`${String(row["lab_id"] ?? "")}:${String(row["user_id"] ?? "")}`);
        return grant?.allowedMinutes == null ? null : Number((grant.allowedMinutes / 60).toFixed(2));
      })(),
      accessEndsAt: persistentLab
        ? (grants.get(`${String(row["lab_id"] ?? "")}:${String(row["user_id"] ?? "")}`)?.accessEndsAt ?? null)
        : null,
      correlationId: (row["correlation_id"] as string | null) ?? null,
      endedReason: (row["ended_reason"] as string | null) ?? null,
    });
  }

  return {
    generatedAt: new Date(now).toISOString(),
    pricingSource: PRICING_SOURCE,
    from,
    to,
    rows: out,
    totals: {
      ...totals,
      vmHours: Number(totals.vmHours.toFixed(2)),
      estimatedCostCents: Math.round(totals.estimatedCostCents),
    },
    byVm: finish(byVm),
    byLearner: finish(byLearner),
    byWorkspace: finish(byWorkspace),
    byLab: finish(byLab),
    bySize: finish(bySize),
    byMode: finish(byMode),
  };
}

/* ------------------------------------------------------------------ */
/* Activity feed                                                       */
/* ------------------------------------------------------------------ */

export type ActivityStream = "user" | "vm" | "admin";

export interface ActivityRow {
  id: string;
  at: string;
  stream: ActivityStream;
  source: "activity_logs" | "session_events" | "lifecycle_events";
  action: string;
  actor: string;
  target: string;
  outcome: "success" | "failure" | "info";
  detail: string | null;
  correlationId: string | null;
  sessionId: string | null;
}

const VM_ACTIONS = /(vm|allocat|provision|deallocat|release|reclaim|pool|start|stop|restart|power)/i;
const ADMIN_ACTIONS = /(admin|workspace|template|lab_|user_|connection|retire|reclaim|assign|access_denied|security)/i;
const CONNECTION_ACTIONS = /(connection|rdp|gateway|endpoint)/i;

function classify(action: string, actorRole?: string | null): ActivityStream {
  if (actorRole === "admin" || actorRole === "superadmin") return "admin";
  if (VM_ACTIONS.test(action) && !CONNECTION_ACTIONS.test(action)) return "vm";
  if (ADMIN_ACTIONS.test(action)) return "admin";
  return "user";
}

export interface ActivityFilters extends UsageFilters {
  stream?: ActivityStream | null;
}

export async function activityFeed(filters: ActivityFilters): Promise<{
  generatedAt: string;
  from: string;
  to: string;
  rows: ActivityRow[];
}> {
  const { from, to } = windowFrom(filters);
  const limit = Math.min(1_000, Math.max(1, filters.limit ?? 300));
  const rows: ActivityRow[] = [];

  // Session ids are the tenant boundary for session_events, which carries no
  // tenant column of its own.
  let sessionIds: string[] = [];
  let sessionLabel = new Map<string, string>();
  try {
    const supabase = await db();
    let q = supabase
      .from("sessions")
      .select("id, user_name, lab_title, vm_name")
      .gte("started_at", from)
      .order("started_at", { ascending: false })
      .limit(500);
    if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
    if (filters.workspaceId) q = q.eq("workspace_id", filters.workspaceId);
    if (filters.labId) q = q.eq("lab_id", filters.labId);
    if (filters.userId) q = q.eq("user_id", filters.userId);
    const { data } = await q;
    for (const s of (data ?? []) as Array<Record<string, unknown>>) {
      sessionIds.push(String(s["id"]));
      sessionLabel.set(
        String(s["id"]),
        [s["user_name"], s["lab_title"], s["vm_name"]].filter(Boolean).join(" · ") || String(s["id"]),
      );
    }
  } catch {
    sessionIds = [];
    sessionLabel = new Map();
  }

  try {
    const supabase = await db();
    let q = supabase
      .from("activity_logs")
      .select("id, at, actor_name, actor_role, action, target_type, target_id, outcome, detail, correlation_id")
      .gte("at", from)
      .lte("at", to)
      .order("at", { ascending: false })
      .limit(limit);
    if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
    if (filters.workspaceId) q = q.eq("workspace_id", filters.workspaceId);
    const { data } = await q;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const action = String(r["action"] ?? "");
      rows.push({
        id: `al-${String(r["id"])}`,
        at: String(r["at"]),
        stream: classify(action, r["actor_role"] as string | null),
        source: "activity_logs",
        action,
        actor: (r["actor_name"] as string | null) ?? "System",
        target: [r["target_type"], r["target_id"]].filter(Boolean).join(":") || "—",
        outcome: (r["outcome"] as ActivityRow["outcome"]) ?? "info",
        detail: (r["detail"] as string | null) ?? null,
        correlationId: (r["correlation_id"] as string | null) ?? null,
        sessionId: null,
      });
    }
  } catch {
    /* activity_logs unavailable */
  }

  if (sessionIds.length) {
    try {
      const supabase = await db();
      const { data } = await supabase
        .from("session_events")
        .select("id, at, session_id, event_type, phase, message, correlation_id")
        .in("session_id", sessionIds.slice(0, 200))
        .gte("at", from)
        .lte("at", to)
        .order("seq", { ascending: false })
        .limit(limit);
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const action = String(r["event_type"] ?? "");
        rows.push({
          id: `se-${String(r["id"])}`,
          at: String(r["at"]),
          stream: classify(action),
          source: "session_events",
          action,
          actor: "Session",
          target: sessionLabel.get(String(r["session_id"])) ?? String(r["session_id"]),
          outcome: /fail|error/i.test(action) ? "failure" : "success",
          detail: (r["message"] as string | null) ?? (r["phase"] as string | null) ?? null,
          correlationId: (r["correlation_id"] as string | null) ?? null,
          sessionId: String(r["session_id"]),
        });
      }
    } catch {
      /* session_events unavailable */
    }
  }

  try {
    const supabase = await db();
    let q = supabase
      .from("lifecycle_events")
      .select("id, at, entity_type, entity_id, phase, status, detail, message, correlation_id, session_id, vm_id")
      .gte("at", from)
      .lte("at", to)
      .order("seq", { ascending: false })
      .limit(limit);
    if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
    const { data } = await q;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const action = `${String(r["entity_type"] ?? "")}.${String(r["phase"] ?? "")}`;
      rows.push({
        id: `le-${String(r["id"])}`,
        at: String(r["at"]),
        stream: String(r["entity_type"] ?? "").toLowerCase() === "vm" ? "vm" : classify(action),
        source: "lifecycle_events",
        action,
        actor: "Orchestrator",
        target: String(r["vm_id"] ?? r["entity_id"] ?? "—"),
        outcome: /fail|error/i.test(String(r["status"] ?? "")) ? "failure" : "success",
        detail: (r["message"] as string | null) ?? (r["detail"] as string | null) ?? null,
        correlationId: (r["correlation_id"] as string | null) ?? null,
        sessionId: (r["session_id"] as string | null) ?? null,
      });
    }
  } catch {
    /* lifecycle_events unavailable */
  }

  const filtered = filters.stream ? rows.filter((r) => r.stream === filters.stream) : rows;
  filtered.sort((a, b) => (a.at < b.at ? 1 : -1));

  return { generatedAt: new Date().toISOString(), from, to, rows: filtered.slice(0, limit) };
}
