import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, TENANT_A, bearer, seedTables } from "../utils/fixtures";
import { setFakeSupabase } from "../utils/supabase-mock";
import { createMockGateway } from "../utils/mock-guacamole";

/**
 * API-level checks against the real route handlers. These prove the HTTP
 * contract a browser sees: unauthenticated calls are refused, one learner can
 * never drive another learner's session or machine, and no gateway credential
 * or private address is ever serialised into a response.
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

const gateway = createMockGateway();
const vm = { status: "READY" };

vi.mock("@/lib/remote-desktop/service.server", () => ({
  remoteDesktop: () => gateway,
}));

vi.mock("@/lib/cloud/controller.server", () => ({
  cloudController: {
    async getVMStatus() {
      return vm.status;
    },
  },
}));

vi.mock("@/lib/vm/private-endpoints.server", () => ({
  resolvePrivateIp: async () => "10.0.0.4",
}));

vi.mock("@/lib/realtime/bus.server", () => ({
  publishLifecycle: async () => undefined,
  publishSessionEvent: async () => undefined,
}));

vi.mock("@/lib/vm/orchestrator.server", () => ({
  orchestrator: {
    async stopVM() {
      return null;
    },
    async getVM() {
      return null;
    },
  },
}));

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>;

function handlers(route: unknown, method: "GET" | "POST" | "DELETE"): Handler {
  const options = (route as { options: { server: { handlers: Record<string, Handler> } } }).options;
  return options.server.handlers[method]!;
}

function req(token: string | null, body?: unknown, method = "POST") {
  return new Request("https://labs.test.invalid/api", {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? bearer(token) : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const authUser = { id: IDS.learner, app_metadata: { provider: "email" }, email: "learner@tenant-a.test" };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      async getUser(token: string) {
        if (token === "expired-token") return { data: { user: null }, error: { message: "JWT expired" } };
        if (token === "bad-token") return { data: { user: null }, error: { message: "invalid claim" } };
        return { data: { user: { ...authUser } }, error: null };
      },
    },
  }),
}));

let sessionId = "";

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  const tables = seedTables();
  tables["sessions"] = [];
  setFakeSupabase(tables);
  gateway.reset();
  vm.status = "READY";
  authUser.id = IDS.learner;

  const { invalidateIdentityCache } = await import("@/lib/security/identity.server");
  invalidateIdentityCache();

  const registry = await import("@/lib/session/registry.server");
  const session = await registry.createSession({
    userId: IDS.learner,
    userName: "Learner A",
    workspaceId: IDS.workspaceA,
    workspaceName: "Workspace A",
    workspaceSlug: "tenant-a-workspace-a",
    labId: IDS.labPublished,
    labName: "Windows 11 Lab",
    vmId: "pool-vm-1",
    vmName: "pool-vm-1",
    provider: "Azure",
    durationMinutes: 120,
    tenantId: TENANT_A,
  });
  sessionId = session.id;
});

async function stateRoute() {
  return (await import("@/routes/api/sessions/$sessionId/state")).Route;
}

async function connectionRoute() {
  return (await import("@/routes/api/sessions/$sessionId/connection")).Route;
}

describe("GET /api/sessions/:id/state", () => {
  it("refuses an unauthenticated request", async () => {
    const response = await handlers(await stateRoute(), "GET")({ request: req(null, undefined, "GET"), params: { sessionId } });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("refuses an expired token distinctly", async () => {
    const response = await handlers(await stateRoute(), "GET")({
      request: req("expired-token", undefined, "GET"),
      params: { sessionId },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_EXPIRED" });
  });

  it("returns the authoritative clock to the owner", async () => {
    const response = await handlers(await stateRoute(), "GET")({
      request: req("learner-token", undefined, "GET"),
      params: { sessionId },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: { id: string }; remainingMs: number; serverTime: string };
    expect(body.session.id).toBe(sessionId);
    expect(body.remainingMs).toBeGreaterThan(0);
    expect(body.serverTime).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses another learner's session", async () => {
    authUser.id = IDS.otherLearner;
    const response = await handlers(await stateRoute(), "GET")({
      request: req("other-token", undefined, "GET"),
      params: { sessionId },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN_SESSION" });
  });

  it("reports a missing session as not found", async () => {
    const response = await handlers(await stateRoute(), "GET")({
      request: req("learner-token", undefined, "GET"),
      params: { sessionId: "ses-does-not-exist" },
    });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/sessions/:id/connection", () => {
  it("brokers a desktop for the owner of a ready machine", async () => {
    const response = await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { vmId: "pool-vm-1", machineName: "pool-vm-1" }),
      params: { sessionId },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { connection: Record<string, unknown> };
    expect(body.connection["state"]).toBeTruthy();
  });

  it("never leaks credentials or the private address", async () => {
    const response = await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { vmId: "pool-vm-1", machineName: "pool-vm-1" }),
      params: { sessionId },
    });
    const raw = await response.text();
    expect(raw).not.toContain("10.0.0.4");
    expect(raw.toLowerCase()).not.toContain("password");
    expect(raw).not.toContain("rdp-secret");
  });

  it("refuses to broker for a machine the session does not own", async () => {
    const response = await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { vmId: "pool-vm-9", machineName: "someone-else" }),
      params: { sessionId },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN_VM" });
  });

  it("refuses a malformed body", async () => {
    const response = await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { machineName: "" }),
      params: { sessionId },
    });
    expect(response.status).toBe(400);
  });

  it("refuses when the machine is not running", async () => {
    vm.status = "STOPPED";
    const response = await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { vmId: "pool-vm-1", machineName: "pool-vm-1" }),
      params: { sessionId },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VM_UNAVAILABLE" });
  });

  it("refuses to broker after the session has ended", async () => {
    const registry = await import("@/lib/session/registry.server");
    await registry.stopSession(sessionId, "user_stopped");
    const response = await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { vmId: "pool-vm-1", machineName: "pool-vm-1" }),
      params: { sessionId },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(response.json()).resolves.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("revokes the connection on DELETE", async () => {
    await handlers(await connectionRoute(), "POST")({
      request: req("learner-token", { vmId: "pool-vm-1", machineName: "pool-vm-1" }),
      params: { sessionId },
    });
    const response = await handlers(await connectionRoute(), "DELETE")({
      request: req("learner-token", undefined, "DELETE"),
      params: { sessionId },
    });
    expect(response.status).toBe(200);
    expect(gateway.terminated).toContain(sessionId);
  });

  it("refuses a DELETE from a different learner", async () => {
    authUser.id = IDS.otherLearner;
    const response = await handlers(await connectionRoute(), "DELETE")({
      request: req("other-token", undefined, "DELETE"),
      params: { sessionId },
    });
    expect(response.status).toBe(403);
  });
});