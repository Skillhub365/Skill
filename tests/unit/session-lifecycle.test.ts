import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFakeSupabase } from "../utils/supabase-mock";
import { seedTables, IDS, TENANT_A } from "../utils/fixtures";
import { createFakeBus } from "../utils/fake-bus";
import { createMockAzure } from "../utils/mock-azure";
import { createMockGateway } from "../utils/mock-guacamole";
import { useFakeClock } from "../utils/clock";
import {
  canTransitionSession,
  canTransitionVm,
  guardSessionTransition,
  isTerminalSessionState,
} from "@/lib/session/state-machine";

/**
 * Session lifecycle: the server clock owns expiry, teardown always runs in the
 * order connection -> VM -> session, and a terminal session can never come
 * back to life.
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


const bus = createFakeBus();
const azure = createMockAzure();
const gateway = createMockGateway();
const order: string[] = [];

vi.mock("@/lib/realtime/bus.server", () => ({
  publishLifecycle: (event: { sessionId: string; phase: string; message?: string }) => bus.publishLifecycle(event),
  publishSessionEvent: async () => undefined,
}));

vi.mock("@/lib/vm/orchestrator.server", () => ({
  orchestrator: {
    async stopVM(vmId: string) {
      order.push("vm.stop");
      return azure.stopVM(vmId);
    },
    async getVM(vmId: string) {
      return azure.getVM(vmId);
    },
  },
}));

vi.mock("@/lib/remote-desktop/service.server", () => ({
  remoteDesktop: () => ({
    async terminateConnection(sessionId: string) {
      order.push("connection.terminate");
      return gateway.terminateConnection(sessionId);
    },
  }),
}));

type Registry = typeof import("@/lib/session/registry.server");

async function freshRegistry(): Promise<Registry> {
  vi.resetModules();
  return import("@/lib/session/registry.server");
}

const baseInput = {
  userId: IDS.learner,
  userName: "Learner A",
  workspaceId: IDS.workspaceA,
  workspaceName: "Workspace A",
  workspaceSlug: "tenant-a-workspace-a",
  labId: IDS.labPublished,
  labName: "Windows 11 Lab",
  vmId: "vm-1",
  vmName: "vm-lab-01",
  provider: "Azure" as const,
  durationMinutes: 120,
  maxExtensionMinutes: 60,
  tenantId: TENANT_A,
};

let clock: ReturnType<typeof useFakeClock>;

beforeEach(async () => {
  // Let any fire-and-forget writes from the previous test settle before the
  // tables are swapped, so nothing leaks across tests.
  await new Promise((resolve) => setImmediate(resolve));
  const tables = seedTables();
  // Session tests own the sessions table; start from an empty one.
  tables["sessions"] = [];
  setFakeSupabase(tables);
  bus.reset();
  gateway.reset();
  order.length = 0;
  await azure.createVM({ name: "vm-lab-01" });
  clock = useFakeClock();
});

afterEach(() => {
  clock.restore();
});

describe("session creation and idempotency", () => {
  it("creates a session with a server-computed expiry", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    expect(session.status).toBe("STARTING");
    expect(new Date(session.expiryTime).getTime() - new Date(session.startTime).getTime()).toBe(120 * 60_000);
  });

  it("returns the same session for a repeated launch key", async () => {
    const registry = await freshRegistry();
    const first = await registry.createSession({ ...baseInput, launchKey: "launch-key-1" });
    const second = await registry.createSession({ ...baseInput, launchKey: "launch-key-1" });
    expect(second.id).toBe(first.id);
  });

  it("finds a learner's live session for the same lab", async () => {
    const registry = await freshRegistry();
    const created = await registry.createSession(baseInput);
    const found = await registry.findLiveSessionFor(IDS.learner, IDS.labPublished);
    expect(found?.id).toBe(created.id);
    expect(await registry.findLiveSessionFor(IDS.otherLearner, IDS.labPublished)).toBeNull();
  });

  it("reports VM ownership from the registry, not from the caller", async () => {
    const registry = await freshRegistry();
    await registry.createSession(baseInput);
    expect(await registry.findVmOwner("vm-1")).toBe(IDS.learner);
    expect(await registry.findVmOwner("vm-someone-else")).toBeNull();
  });
});

describe("expiry and teardown", () => {
  it("keeps a session live before expiry", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    clock.jumpMinutes(60);
    await registry.heartbeat(session.id);
    const snapshot = await registry.getSession(session.id);
    expect(snapshot?.session.status).not.toBe("EXPIRED");
    expect(snapshot?.remainingMs).toBeGreaterThan(0);
  });

  it("expires the session and deallocates the VM once the clock runs out", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    clock.jumpMinutes(121);
    const snapshot = await registry.getSession(session.id);
    expect(snapshot?.session.status).toBe("EXPIRED");
    expect(snapshot?.session.endReason).toBe("expired");
    expect(snapshot?.remainingMs).toBe(0);
    expect(azure.vms.get("vm-1")?.status).toBe("STOPPED");
  });

  it("tears down in the order connection -> VM -> session", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    clock.jumpMinutes(121);
    await registry.getSession(session.id);
    expect(order).toEqual(["connection.terminate", "vm.stop"]);
    expect(gateway.terminated).toContain(session.id);
  });

  it("streams STOPPING then STOPPED to the learner", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    clock.jumpMinutes(121);
    await registry.getSession(session.id);
    expect(bus.forSession(session.id).map((e) => e.phase)).toEqual(["STOPPING", "STOPPED"]);
  });

  it("reclaims an abandoned session when heartbeats stop", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    clock.jumpMinutes(15);
    const snapshot = await registry.getSession(session.id);
    expect(snapshot?.session.status).toBe("STOPPED");
    expect(snapshot?.session.endReason).toBe("abandoned");
  });

  it("keeps a heartbeating session alive well past the idle grace window", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    for (let i = 0; i < 20; i += 1) {
      clock.jumpMinutes(2);
      await registry.heartbeat(session.id);
    }
    const snapshot = await registry.getSession(session.id);
    expect(snapshot?.session.status).not.toBe("STOPPED");
  });

  it("is idempotent: a second stop does not stop the VM twice", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    await registry.stopSession(session.id, "user_stopped");
    const stopCalls = order.filter((entry) => entry === "vm.stop").length;
    await registry.stopSession(session.id, "user_stopped");
    expect(order.filter((entry) => entry === "vm.stop").length).toBe(stopCalls);
  });

  it("marks a failed launch as ERROR and releases resources", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    const failed = await registry.failSession(session.id, "The VM failed to start.");
    expect(failed?.status).toBe("ERROR");
    expect(failed?.endReason).toBe("vm_failure");
    expect(azure.vms.get("vm-1")?.status).toBe("STOPPED");
  });
});

describe("extension", () => {
  it("extends within the allowance and moves expiry forward", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    const before = new Date(session.expiryTime).getTime();
    const result = await registry.extendSession(session.id, 30);
    expect(result.error).toBeUndefined();
    expect(new Date(result.snapshot!.session.expiryTime).getTime()).toBe(before + 30 * 60_000);
  });

  it("refuses to extend beyond the allowance", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    await registry.extendSession(session.id, 60);
    const result = await registry.extendSession(session.id, 30);
    expect(result.error).toBeTruthy();
  });

  it("refuses to extend an ended session", async () => {
    const registry = await freshRegistry();
    const session = await registry.createSession(baseInput);
    await registry.stopSession(session.id, "user_stopped");
    const result = await registry.extendSession(session.id, 15);
    expect(result.error).toBeTruthy();
  });
});

describe("state machine", () => {
  it("allows the happy launch path", () => {
    expect(canTransitionSession("REQUESTED", "ALLOCATING")).toBe(true);
    expect(canTransitionSession("STARTING", "READY")).toBe(true);
    expect(canTransitionSession("READY", "ACTIVE")).toBe(true);
    expect(canTransitionSession("ACTIVE", "STOPPING")).toBe(true);
    expect(canTransitionSession("STOPPING", "STOPPED")).toBe(true);
  });

  it("treats EXPIRED, STOPPED and ERROR as terminal", () => {
    for (const state of ["EXPIRED", "STOPPED", "ERROR"] as const) {
      expect(isTerminalSessionState(state)).toBe(true);
      expect(canTransitionSession(state, "ACTIVE")).toBe(false);
    }
  });

  it("refuses a late provider callback on a stopped session", () => {
    expect(guardSessionTransition("ses-1", "STOPPED", "READY")).toBe(false);
  });

  it("allows idempotent re-application of the same state", () => {
    expect(canTransitionSession("ACTIVE", "ACTIVE")).toBe(true);
    expect(canTransitionVm("READY", "READY")).toBe(true);
  });

  it("never lets a retired pool VM be allocated again", () => {
    expect(canTransitionVm("RETIRED", "AVAILABLE")).toBe(false);
    expect(canTransitionVm("AVAILABLE", "ALLOCATED")).toBe(true);
    expect(canTransitionVm("IN_USE", "ALLOCATED")).toBe(false);
  });
});