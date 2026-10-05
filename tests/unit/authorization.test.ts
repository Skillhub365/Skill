import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, setFakeSupabase } from "../utils/supabase-mock";
import { IDS, TENANT_A, TENANT_B, seedTables } from "../utils/fixtures";

/**
 * Identity resolution and the central authorization guard.
 *
 * The rule under test everywhere here: nothing the caller sends is trusted.
 * Role, tenant, workspace membership and lab entitlement all come from
 * database records.
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


/** Auth token verification is the only external call; it is always mocked. */
const authUser = { id: IDS.learner, app_metadata: { provider: "email" } as Record<string, unknown> };
const getUser = vi.fn(async (token: string) => {
  if (token === "expired-token") return { data: { user: null }, error: { message: "JWT expired" } };
  if (token === "bad-token") return { data: { user: null }, error: { message: "invalid claim" } };
  return { data: { user: authUser }, error: null };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: (token: string) => getUser(token) } }),
}));

async function identityModule() {
  return import("@/lib/security/identity.server");
}

function request(token?: string) {
  return new Request("https://skilltrack.test/api/labs/x/start", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(async () => {
  setFakeSupabase(seedTables());
  authUser.id = IDS.learner;
  authUser.app_metadata = { provider: "email" };
  const { invalidateIdentityCache } = await identityModule();
  invalidateIdentityCache();
});

describe("identity resolution", () => {
  it("hydrates role, tenant, workspaces and labs from database records", async () => {
    const { resolveIdentity } = await identityModule();
    const result = await resolveIdentity("valid-token");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.sub).toBe(IDS.learner);
    expect(result.principal.role).toBe("user");
    expect(result.principal.tenantId).toBe(TENANT_A);
    expect(result.principal.org).toBe("Tenant A");
    expect(result.principal.workspaceIds).toEqual([IDS.workspaceA]);
    expect(result.principal.labIds).toContain(IDS.labPublished);
    // Only non-revoked assignments are hydrated.
    expect(result.principal.labIds).not.toContain(IDS.labTenantB);
  });

  it("resolves the highest granted role for an administrator", async () => {
    authUser.id = IDS.admin;
    const { resolveIdentity } = await identityModule();
    const result = await resolveIdentity("admin-token");
    expect(result.ok && result.principal.role).toBe("admin");
  });

  it("marks an Entra sign-in as such", async () => {
    authUser.app_metadata = { provider: "azure" };
    const { resolveIdentity } = await identityModule();
    const result = await resolveIdentity("entra-token");
    expect(result.ok && result.principal.idp).toBe("entra");
  });

  it("denies a suspended account even with a valid token", async () => {
    authUser.id = IDS.suspended;
    const { resolveIdentity } = await identityModule();
    const result = await resolveIdentity("suspended-token");
    expect(result).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("denies a token with no profile record", async () => {
    authUser.id = "00000000-0000-4000-8000-00000000dead";
    const { resolveIdentity } = await identityModule();
    const result = await resolveIdentity("ghost-token");
    expect(result).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("reports an expired token distinctly from an invalid one", async () => {
    const { resolveIdentity } = await identityModule();
    expect(await resolveIdentity("expired-token")).toEqual({ ok: false, reason: "AUTH_EXPIRED" });
    expect(await resolveIdentity("bad-token")).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("re-reads authoritative rows after the cache is invalidated", async () => {
    const { resolveIdentity, invalidateIdentityCache } = await identityModule();
    const first = await resolveIdentity("cache-token");
    expect(first.ok && first.principal.role).toBe("user");

    // Promote the learner in the database.
    const supabase = fakeSupabase();
    supabase.tables["user_roles"]?.push({ user_id: IDS.learner, role: "admin" });

    // Still cached: the old identity is served.
    const cached = await resolveIdentity("cache-token");
    expect(cached.ok && cached.principal.role).toBe("user");

    invalidateIdentityCache(IDS.learner);
    const fresh = await resolveIdentity("cache-token");
    expect(fresh.ok && fresh.principal.role).toBe("admin");
  });

  it("ignores revoked assignments and inactive memberships", async () => {
    authUser.id = IDS.otherLearner;
    const supabase = fakeSupabase();
    supabase.tables["lab_assignments"] = [
      { id: "la-x", lab_id: IDS.labPublished, user_id: IDS.otherLearner, status: "revoked" },
    ];
    supabase.tables["workspace_users"] = [
      { id: "wu-x", workspace_id: IDS.workspaceA, user_id: IDS.otherLearner, status: "suspended", capabilities: [] },
    ];
    const { resolveIdentity } = await identityModule();
    const result = await resolveIdentity("other-token");
    expect(result.ok && result.principal.labIds).toEqual([]);
    expect(result.ok && result.principal.workspaceIds).toEqual([]);
  });
});

describe("authorize()", () => {
  it("denies a request with no bearer token", async () => {
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request());
    expect("denied" in result).toBe(true);
    if (!("denied" in result)) return;
    expect(result.denied.status).toBe(401);
    await expect(result.denied.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("allows an assigned learner to reach their own lab", async () => {
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("valid-token"), {
      labId: IDS.labPublished,
      workspaceId: IDS.workspaceA,
    });
    expect("context" in result).toBe(true);
  });

  it("denies a lab the learner is not assigned to", async () => {
    const supabase = fakeSupabase();
    supabase.tables["lab_assignments"] = [];
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("valid-token"), { labId: IDS.labPublished });
    expect("denied" in result).toBe(true);
    if (!("denied" in result)) return;
    expect(result.denied.status).toBe(403);
    await expect(result.denied.json()).resolves.toMatchObject({ code: "FORBIDDEN_LAB" });
  });

  it("denies cross-tenant workspace access regardless of role", async () => {
    authUser.id = IDS.admin;
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("admin-token"), { workspaceId: IDS.workspaceB });
    expect("denied" in result).toBe(true);
    if (!("denied" in result)) return;
    await expect(result.denied.json()).resolves.toMatchObject({ code: "FORBIDDEN_ORG" });
  });

  it("denies a cross-tenant lab", async () => {
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("valid-token"), { labId: IDS.labTenantB });
    expect("denied" in result).toBe(true);
    if (!("denied" in result)) return;
    await expect(result.denied.json()).resolves.toMatchObject({ code: "FORBIDDEN_ORG" });
  });

  it("denies an unpublished lab to a learner but allows an admin", async () => {
    const { authorize } = await import("@/lib/security/guard.server");
    const learner = await authorize(request("valid-token"), { labId: IDS.labDraft });
    expect("denied" in learner).toBe(true);

    authUser.id = IDS.admin;
    const admin = await authorize(request("admin-token"), { labId: IDS.labDraft });
    expect("context" in admin).toBe(true);
  });

  it("denies a learner on an admin-only role requirement", async () => {
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("valid-token"), { role: "admin" });
    expect("denied" in result).toBe(true);
    if (!("denied" in result)) return;
    expect(result.denied.status).toBe(403);
    await expect(result.denied.json()).resolves.toMatchObject({ code: "FORBIDDEN_ROLE" });
  });

  it("denies an admin on a super-admin cloud route, and allows a super admin", async () => {
    authUser.id = IDS.admin;
    const { authorizeCloudAdmin } = await import("@/lib/security/guard.server");
    const admin = await authorizeCloudAdmin(request("admin-token"));
    expect("denied" in admin).toBe(true);

    const supabase = fakeSupabase();
    supabase.tables["profiles"]?.push({
      id: IDS.superadmin,
      email: "superadmin@tenant-a.test",
      full_name: "Test Super Admin",
      status: "active",
      tenant_id: TENANT_A,
    });
    authUser.id = IDS.superadmin;
    const superadmin = await authorizeCloudAdmin(request("superadmin-token"));
    expect("context" in superadmin).toBe(true);
  });

  it("denies an inactive workspace to a learner", async () => {
    const supabase = fakeSupabase();
    supabase.tables["workspace_users"]?.push({
      id: "wu-archived",
      workspace_id: IDS.workspaceArchived,
      user_id: IDS.learner,
      status: "active",
      capabilities: [],
    });
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("valid-token"), { workspaceId: IDS.workspaceArchived });
    expect("denied" in result).toBe(true);
    if (!("denied" in result)) return;
    await expect(result.denied.json()).resolves.toMatchObject({ code: "WORKSPACE_UNAVAILABLE" });
  });

  it("denies a capability the role does not hold", async () => {
    authUser.id = IDS.admin;
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("admin-token"), { role: "admin", capability: "cost:manage" });
    expect("denied" in result).toBe(true);
  });

  it("never echoes the bearer token in a denial body", async () => {
    const { authorize } = await import("@/lib/security/guard.server");
    const result = await authorize(request("valid-token"), { role: "superadmin" });
    if (!("denied" in result)) throw new Error("expected denial");
    const body = await result.denied.text();
    expect(body).not.toContain("valid-token");
  });
});

describe("capability matrix", () => {
  it("keeps cost and cloud management with the super admin only", async () => {
    const { can } = await import("@/lib/security/types");
    expect(can("superadmin", "cloud:manage")).toBe(true);
    expect(can("admin", "cloud:manage")).toBe(false);
    expect(can("admin", "lab:manage")).toBe(true);
    expect(can("user", "lab:start")).toBe(true);
    expect(can("user", "vm:manage")).toBe(false);
    expect(can(undefined, "lab:read")).toBe(false);
  });
});

/** Tenant B exists in every seed so isolation is always exercised. */
it("seeds two tenants", () => {
  expect(TENANT_A).not.toBe(TENANT_B);
});