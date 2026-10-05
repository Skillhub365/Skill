import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, TENANT_A, seedTables } from "../utils/fixtures";
import { setFakeSupabase } from "../utils/supabase-mock";

/**
 * Production acceptance checks.
 *
 * These assert the *outcomes* an operator signs off during the pilot, rather
 * than individual units: a learner's session-based and persistent runs both
 * appear in usage reporting with the right allowance figures, and the live
 * operations snapshot surfaces the conditions (stuck launch, orphan machine,
 * stale reaper, low capacity) that a pilot must not silently run with.
 */

const supabaseState = vi.hoisted(() => ({
  client: () => (globalThis as { __fakeSupabase?: { client: unknown } }).__fakeSupabase!.client,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return supabaseState.client();
  },
  supabaseServer: () => supabaseState.client(),
}));

vi.mock("@/lib/db/client.server", () => ({
  db: async () => supabaseState.client(),
}));

const NOW = new Date("2026-03-10T12:00:00.000Z");
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

function ts() {
  return { created_at: iso(10_000), updated_at: iso(1) };
}

/** Seed one completed session-based run and one completed persistent run. */
function seedJourney() {
  const tables = seedTables();
  tables["lab_assignments"] = [
    ...(tables["lab_assignments"] as Array<Record<string, unknown>>),
    {
      id: "la-persistent",
      lab_id: IDS.labDraft,
      user_id: IDS.learner,
      status: "active",
      allowed_minutes: 600,
      remaining_minutes: 420,
      access_starts_at: iso(20_000),
      access_ends_at: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      ...ts(),
    },
  ];
  tables["sessions"] = [
    {
      id: "sess-session-based",
      tenant_id: TENANT_A,
      workspace_id: IDS.workspaceA,
      workspace_name: "Workspace A",
      lab_id: IDS.labPublished,
      lab_title: "Published Lab",
      user_id: IDS.learner,
      user_name: "Test Learner",
      vm_id: "vm-1",
      vm_name: "stl-vm-1",
      vm_size: "Standard_D2s_v5",
      status: "COMPLETED",
      started_at: iso(300),
      ended_at: iso(240),
      ended_reason: "USER_STOPPED",
      correlation_id: "corr-1",
      hourly_rate_cents: 20,
      duration_minutes: 60,
      extended_minutes: 0,
      lab_mode: "session",
      billable_minutes: null,
      ...ts(),
    },
    {
      id: "sess-persistent",
      tenant_id: TENANT_A,
      workspace_id: IDS.workspaceA,
      workspace_name: "Workspace A",
      lab_id: IDS.labDraft,
      lab_title: "Persistent Lab",
      user_id: IDS.learner,
      user_name: "Test Learner",
      vm_id: "vm-2",
      vm_name: "stl-vm-2",
      vm_size: "Standard_D4s_v5",
      status: "STOPPED",
      started_at: iso(180),
      ended_at: iso(60),
      ended_reason: "USER_STOPPED",
      correlation_id: "corr-2",
      hourly_rate_cents: 40,
      duration_minutes: 120,
      extended_minutes: 0,
      lab_mode: "persistent",
      billable_minutes: 120,
      ...ts(),
    },
  ];
  tables["vm_pool_entries"] = [
    {
      id: "vm-1",
      name: "stl-vm-1",
      azure_vm_name: "stl-vm-1",
      azure_resource_id:
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/stl-vm-1",
      region: "uksouth",
      vm_size: "Standard_D2s_v5",
      status: "AVAILABLE",
      tenant_id: TENANT_A,
      ...ts(),
    },
    {
      id: "vm-2",
      name: "stl-vm-2",
      azure_vm_name: "stl-vm-2",
      azure_resource_id:
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/stl-vm-2",
      region: "uksouth",
      vm_size: "Standard_D4s_v5",
      status: "IN_USE",
      tenant_id: TENANT_A,
      orphaned: true,
      ...ts(),
    },
  ];
  return tables;
}

describe("production acceptance — usage reporting", () => {
  beforeEach(() => {
    vi.resetModules();
    setFakeSupabase(seedJourney());
  });

  it("reports both the session-based and the persistent run for the learner", async () => {
    const { sessionUsage } = await import("@/lib/reporting/usage-detail.server");
    const report = await sessionUsage({ from: iso(1_000), to: NOW.toISOString(), tenantId: TENANT_A });

    const ids = report.rows.map((r) => r.sessionId).sort();
    expect(ids).toEqual(["sess-persistent", "sess-session-based"]);
    expect(report.totals.sessions).toBe(2);

    const modes = Object.fromEntries(report.byMode.map((m) => [m.key, m.sessions]));
    expect(modes["persistent"]).toBe(1);
    expect(modes["session_based"]).toBe(1);
  });

  it("carries every column the operator signs off, including persistent allowance", async () => {
    const { sessionUsage } = await import("@/lib/reporting/usage-detail.server");
    const report = await sessionUsage({ from: iso(1_000), to: NOW.toISOString(), tenantId: TENANT_A });

    const persistent = report.rows.find((r) => r.sessionId === "sess-persistent")!;
    expect(persistent.assignmentType).toBe("persistent");
    expect(persistent.learnerName).toBe("Test Learner");
    expect(persistent.lab).toBe("Persistent Lab");
    expect(persistent.workspace).toBe("Workspace A");
    expect(persistent.vmName).toBe("stl-vm-2");
    expect(persistent.startedAt).toBeTruthy();
    expect(persistent.endedAt).toBeTruthy();
    expect(persistent.durationMinutes).toBeGreaterThan(0);
    expect(persistent.estimatedCostCents).toBeGreaterThan(0);
    expect(persistent.persistentAllowedHours).toBe(10);
    expect(persistent.persistentRemainingHours).toBe(7);
    expect(persistent.accessEndsAt).toBeTruthy();

    const based = report.rows.find((r) => r.sessionId === "sess-session-based")!;
    expect(based.assignmentType).toBe("session-based");
    expect(based.persistentRemainingHours).toBeNull();
  });

  it("never exposes a full Azure resource id in reporting output", async () => {
    const { sessionUsage } = await import("@/lib/reporting/usage-detail.server");
    const report = await sessionUsage({ from: iso(1_000), to: NOW.toISOString(), tenantId: TENANT_A });
    for (const row of report.rows) {
      expect(row.azureResourceId ?? "").not.toContain("/subscriptions/00000000-0000-0000-0000-000000000000");
    }
  });
});

describe("production acceptance — live operations snapshot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("flags stuck launches, orphan machines, low capacity and a stale reaper", async () => {
    const tables = seedJourney();
    (tables["sessions"] as Array<Record<string, unknown>>).push({
      id: "sess-stuck",
      tenant_id: TENANT_A,
      status: "STARTING",
      started_at: iso(45),
      user_name: "Test Learner",
      lab_title: "Published Lab",
      vm_name: "stl-vm-1",
      ...ts(),
    });
    setFakeSupabase(tables);

    const { operationalSnapshot } = await import("@/lib/observability/operational-state.server");
    const snapshot = await operationalSnapshot();

    const counter = (key: string) => snapshot.counters.find((c) => c.key === key)!;
    expect(counter("active-sessions").value).toBe(1);
    expect(counter("stuck-sessions").value).toBe(1);
    expect(counter("stuck-sessions").severity).toBe("critical");
    expect(counter("orphan-vms").value).toBe(1);

    expect(snapshot.capacity.total).toBe(2);
    expect(snapshot.capacity.available).toBe(1);
    expect(snapshot.reaper.stale).toBe(true);
    expect(snapshot.degraded).toBe(true);
  });

  it("reports a clean platform when nothing is stuck or orphaned", async () => {
    const tables = seedTables();
    tables["vm_pool_entries"] = Array.from({ length: 5 }, (_, i) => ({
      id: `vm-clean-${i}`,
      name: `stl-clean-${i}`,
      status: "AVAILABLE",
      tenant_id: TENANT_A,
      ...ts(),
    }));
    tables["cleanup_runs"] = [
      { id: "run-1", status: "ok", started_at: iso(2), finished_at: iso(1), failures: 0, reclaimed: 3, ...ts() },
    ];
    setFakeSupabase(tables);

    const { operationalSnapshot } = await import("@/lib/observability/operational-state.server");
    const snapshot = await operationalSnapshot();

    expect(snapshot.counters.find((c) => c.key === "stuck-sessions")!.value).toBe(0);
    expect(snapshot.counters.find((c) => c.key === "orphan-vms")!.value).toBe(0);
    expect(snapshot.capacity.severity).toBe("ok");
    expect(snapshot.reaper.stale).toBe(false);
    expect(snapshot.degraded).toBe(false);
  });
});
