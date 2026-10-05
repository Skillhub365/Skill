import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, setFakeSupabase } from "../utils/supabase-mock";
import { IDS, TENANT_A, TENANT_B, seedTables } from "../utils/fixtures";

/**
 * `resolveLaunchPlan()` is the server-authoritative answer to "what exactly do
 * we start, and is this person allowed to start it". A tampered request body
 * must not be able to change any part of the answer.
 */

const supabaseState = vi.hoisted(() => ({
  client: () => (globalThis as { __fakeSupabase?: { client: unknown } }).__fakeSupabase!.client,
}));

// A synchronous factory: an async one races when several dynamic imports of
// this module resolve in the same tick.
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return supabaseState.client();
  },
  supabaseServer: () => supabaseState.client(),
}));

// Repositories reach the database through this single seam; mocking it too
// keeps concurrent dynamic imports from resolving the real client.
vi.mock("@/lib/db/client.server", () => ({
  db: async () => supabaseState.client(),
}));


const learner = { sub: IDS.learner, role: "user", tenantId: TENANT_A };
const admin = { sub: IDS.admin, role: "admin", tenantId: TENANT_A };
const foreign = { sub: IDS.foreignLearner, role: "user", tenantId: TENANT_B };

async function resolve(labId: string, principal: { sub: string; role: string; tenantId: string | null }) {
  const { resolveLaunchPlan } = await import("@/lib/db/launch.repo.server");
  return resolveLaunchPlan(labId, principal);
}

beforeEach(() => {
  setFakeSupabase(seedTables());
});

describe("resolveLaunchPlan", () => {
  it("resolves a published lab for an assigned learner", async () => {
    const result = await resolve(IDS.labPublished, learner);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tenantId).toBe(TENANT_A);
    expect(result.plan.workspace.id).toBe(IDS.workspaceA);
    expect(result.plan.lab.id).toBe(IDS.labPublished);
  });

  it("takes image, region, size, provider, duration and template from the database", async () => {
    const result = await resolve(IDS.labPublished, learner);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.template).toMatchObject({
      id: IDS.templateA,
      provider: "Azure",
      region: "westeurope",
      size: "Standard_D4s_v5",
      image: "/subscriptions/fake/images/win11-lab/versions/1.0.0",
    });
    expect(result.plan.durationMinutes).toBe(120);
    expect(result.plan.maxExtensionMinutes).toBe(60);
  });

  it("lets an administrator resolve a lab in their own tenant", async () => {
    const result = await resolve(IDS.labPublished, admin);
    expect(result.ok).toBe(true);
  });

  it("lets an administrator resolve an unpublished lab, but not a learner", async () => {
    expect((await resolve(IDS.labDraft, admin)).ok).toBe(true);
    const denied = await resolve(IDS.labDraft, learner);
    expect(denied).toMatchObject({ ok: false, reason: "LAB_UNAVAILABLE" });
  });

  it("denies an unassigned learner", async () => {
    const supabase = fakeSupabase();
    supabase.tables["lab_assignments"] = [];
    const result = await resolve(IDS.labPublished, learner);
    expect(result).toMatchObject({ ok: false, reason: "FORBIDDEN_LAB" });
  });

  it("denies a revoked assignment", async () => {
    const result = await resolve(IDS.labPublished, {
      sub: IDS.otherLearner,
      role: "user",
      tenantId: TENANT_A,
    });
    expect(result).toMatchObject({ ok: false, reason: "FORBIDDEN_LAB" });
  });

  it("denies a learner without an active workspace membership", async () => {
    const supabase = fakeSupabase();
    supabase.tables["workspace_users"] = [];
    const result = await resolve(IDS.labPublished, learner);
    expect(result).toMatchObject({ ok: false, reason: "WORKSPACE_UNAVAILABLE" });
  });

  it("denies a cross-tenant learner before anything else", async () => {
    const result = await resolve(IDS.labPublished, foreign);
    expect(result).toMatchObject({ ok: false, reason: "FORBIDDEN_ORG" });
  });

  it("denies a cross-tenant administrator", async () => {
    const result = await resolve(IDS.labTenantB, admin);
    expect(result).toMatchObject({ ok: false, reason: "FORBIDDEN_ORG" });
  });

  it("denies a lab in an inactive workspace", async () => {
    const result = await resolve(IDS.labArchivedWorkspace, learner);
    expect(result).toMatchObject({ ok: false, reason: "WORKSPACE_UNAVAILABLE" });
  });

  it("denies a missing lab", async () => {
    const result = await resolve("ddddddd1-0000-4000-8000-0000000000ff", learner);
    expect(result).toMatchObject({ ok: false, reason: "LAB_UNAVAILABLE" });
  });

  it("denies a lab whose template is disabled", async () => {
    const result = await resolve(IDS.labDisabledTemplate, learner);
    expect(result).toMatchObject({ ok: false, reason: "TEMPLATE_UNAVAILABLE" });
  });

  it("denies a lab with no template and no workspace default", async () => {
    const supabase = fakeSupabase();
    const workspace = supabase.tables["workspaces"]?.find((row) => row["id"] === IDS.workspaceA);
    if (workspace) workspace["default_template_id"] = null;
    const lab = supabase.tables["labs"]?.find((row) => row["id"] === IDS.labPublished);
    if (lab) lab["template_id"] = null;
    const result = await resolve(IDS.labPublished, learner);
    expect(result).toMatchObject({ ok: false, reason: "TEMPLATE_UNAVAILABLE" });
  });

  it("denies an unsupported cloud provider", async () => {
    const result = await resolve(IDS.labAwsTemplate, learner);
    expect(result).toMatchObject({ ok: false, reason: "PROVIDER_UNSUPPORTED" });
  });

  it("denies a template that belongs to another tenant", async () => {
    const supabase = fakeSupabase();
    const template = supabase.tables["templates"]?.find((row) => row["id"] === IDS.templateA);
    if (template) template["tenant_id"] = TENANT_B;
    const result = await resolve(IDS.labPublished, learner);
    expect(result).toMatchObject({ ok: false, reason: "FORBIDDEN_ORG" });
  });

  it("falls back to the workspace cloud binding when the template has none", async () => {
    const supabase = fakeSupabase();
    const template = supabase.tables["templates"]?.find((row) => row["id"] === IDS.templateA);
    if (template) template["cloud_connection_id"] = null;
    const result = await resolve(IDS.labPublished, learner);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.template.cloudConnectionId).toBe(IDS.connectionA);
  });

  it("reports no cloud binding when neither template nor workspace has one", async () => {
    const supabase = fakeSupabase();
    const template = supabase.tables["templates"]?.find((row) => row["id"] === IDS.templateA);
    if (template) template["cloud_connection_id"] = null;
    const workspace = supabase.tables["workspaces"]?.find((row) => row["id"] === IDS.workspaceA);
    if (workspace) workspace["cloud_connection_id"] = null;
    const result = await resolve(IDS.labPublished, learner);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan.template.cloudConnectionId).toBeNull();
  });
});

describe("capacity policy", () => {
  it("uses platform defaults when no workspace or tenant limit is set", async () => {
    const { resolvePolicy } = await import("@/lib/launch/policy.server");
    const policy = await resolvePolicy(TENANT_A, IDS.workspaceA);
    expect(policy.maxSessionMinutes).toBe(480);
    expect(policy.maxConcurrentUserSessions).toBe(1);
  });

  it("prefers the workspace limit over the tenant limit", async () => {
    const supabase = fakeSupabase();
    const workspace = supabase.tables["workspaces"]?.find((row) => row["id"] === IDS.workspaceA);
    if (workspace) workspace["max_session_minutes"] = 90;
    const tenant = supabase.tables["tenants"]?.find((row) => row["id"] === TENANT_A);
    if (tenant) tenant["max_session_minutes"] = 240;
    const { resolvePolicy } = await import("@/lib/launch/policy.server");
    const policy = await resolvePolicy(TENANT_A, IDS.workspaceA);
    expect(policy.maxSessionMinutes).toBe(90);
  });

  it("clamps a requested duration to the policy maximum", async () => {
    const { clampDuration, resolvePolicy } = await import("@/lib/launch/policy.server");
    const policy = await resolvePolicy(TENANT_A, IDS.workspaceA);
    expect(clampDuration(10_000, policy)).toBe(policy.maxSessionMinutes);
    expect(clampDuration(30, policy)).toBe(30);
  });

  it("refuses a second concurrent session for the same learner", async () => {
    const supabase = fakeSupabase();
    supabase.tables["sessions"] = [
      { id: "ses-live", user_id: IDS.learner, workspace_id: IDS.workspaceA, tenant_id: TENANT_A, status: "ACTIVE" },
    ];
    const { checkCapacity } = await import("@/lib/launch/policy.server");
    const result = await checkCapacity({
      tenantId: TENANT_A,
      workspaceId: IDS.workspaceA,
      userId: IDS.learner,
      templateId: IDS.templateA,
    });
    expect(result).toMatchObject({ ok: false, reason: "USER_LIMIT" });
  });
});