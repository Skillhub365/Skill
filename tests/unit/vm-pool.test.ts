import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, setFakeSupabase } from "../utils/supabase-mock";
import { seedTables, IDS } from "../utils/fixtures";
import { allocatePoolVmHandler, poolRow } from "../utils/pool-fixtures";
import { createMockAzure } from "../utils/mock-azure";

/**
 * VM pool allocation. The critical property is that one machine is handed to
 * exactly one learner, that a failed launch always returns it, and that a
 * lease which outlives its launch is reclaimed.
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


const azure = createMockAzure();

vi.mock("@/lib/vm/pool/provider.server", () => ({
  poolProvider: () => ({
    async stopVM(vmId: string) {
      return azure.stopVM(vmId);
    },
    async startVM(vmId: string) {
      return azure.startVM(vmId);
    },
    async getVM(vmId: string) {
      return azure.getVM(vmId);
    },
  }),
}));

type Allocator = typeof import("@/lib/vm/pool/allocator.server");

async function freshPool(vmCount: number): Promise<Allocator> {
  await new Promise((resolve) => setImmediate(resolve));
  const tables = seedTables();
  tables["sessions"] = [];
  tables["vm_pool_entries"] = Array.from({ length: vmCount }, (_, index) =>
    poolRow({ id: `pool-vm-${index + 1}`, template_id: IDS.templateA }),
  );
  const client = setFakeSupabase(tables);
  client.rpcHandlers["allocate_pool_vm"] = allocatePoolVmHandler(client.tables);
  // The pool cache lives on globalThis, so clear it for a truly fresh pool.
  delete (globalThis as Record<string, unknown>)["__skilltrack_vm_pool__"];
  // Warm the lazily-imported repository so the concurrency test races on
  // allocation, not on module loading.
  await import("@/lib/db/vm-pool.repo.server");
  return import("@/lib/vm/pool/allocator.server");
}

function request(userId: string) {
  return {
    templateId: IDS.templateA,
    workspaceId: IDS.workspaceA,
    labId: IDS.labPublished,
    userId,
    userName: userId,
    sessionId: null,
  };
}

beforeEach(() => {
  azure.calls.length = 0;
});

describe("atomic allocation", () => {
  it("claims one machine and marks it allocated", async () => {
    const allocator = await freshPool(2);
    const vm = await allocator.allocateVm(request(IDS.learner));
    expect(vm.status).toBe("ALLOCATED");
    expect(vm.assignedUserId).toBe(IDS.learner);
    expect(vm.allocationExpiresAt).toBeTruthy();
  });

  it("never hands the same machine to two concurrent launches", async () => {
    const allocator = await freshPool(2);
    const results = await Promise.allSettled([
      allocator.allocateVm(request("user-1")),
      allocator.allocateVm(request("user-2")),
      allocator.allocateVm(request("user-3")),
      allocator.allocateVm(request("user-4")),
    ]);
    const claimed = results.filter((r) => r.status === "fulfilled");
    const ids = claimed.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(claimed).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("fails with a friendly capacity error when the pool is exhausted", async () => {
    const allocator = await freshPool(1);
    await allocator.allocateVm(request("user-1"));
    await expect(allocator.allocateVm(request("user-2"))).rejects.toThrow(allocator.NoCapacityError);
  });

  it("explains that no machines are registered for an unknown image", async () => {
    const allocator = await freshPool(0);
    await expect(allocator.allocateVm(request("user-1"))).rejects.toThrow(/No lab machines are registered/);
  });

  it("counts remaining capacity from the database", async () => {
    const allocator = await freshPool(3);
    expect(await allocator.availableCapacity(IDS.templateA, IDS.workspaceA)).toBe(3);
    await allocator.allocateVm(request("user-1"));
    expect(await allocator.availableCapacity(IDS.templateA, IDS.workspaceA)).toBe(2);
  });

  it("reports whether the pool serves a template at all", async () => {
    const allocator = await freshPool(1);
    expect(await allocator.poolServesTemplate(IDS.templateA)).toBe(true);
    expect(await allocator.poolServesTemplate("template-with-no-pool")).toBe(false);
  });
});

describe("release and leases", () => {
  it("returns a machine to the pool and clears its owner", async () => {
    const allocator = await freshPool(1);
    const vm = await allocator.allocateVm(request(IDS.learner));
    const released = await allocator.releaseVm(vm.id, "system:test");
    expect(released?.status).toBe("AVAILABLE");
    expect(released?.assignedUserId).toBeNull();
    expect(released?.currentSessionId).toBeNull();
    expect(released?.allocationExpiresAt).toBeNull();
    expect(await allocator.availableCapacity(IDS.templateA, IDS.workspaceA)).toBe(1);
  });

  it("is idempotent when the same machine is released twice", async () => {
    const allocator = await freshPool(1);
    const vm = await allocator.allocateVm(request(IDS.learner));
    await allocator.releaseVm(vm.id);
    await allocator.releaseVm(vm.id);
    expect(await allocator.availableCapacity(IDS.templateA, IDS.workspaceA)).toBe(1);
  });

  it("makes a released machine claimable again", async () => {
    const allocator = await freshPool(1);
    const first = await allocator.allocateVm(request("user-1"));
    await allocator.releaseVm(first.id);
    const second = await allocator.allocateVm(request("user-2"));
    expect(second.id).toBe(first.id);
    expect(second.assignedUserId).toBe("user-2");
  });

  it("binds the session id to the claimed machine", async () => {
    const allocator = await freshPool(1);
    const vm = await allocator.allocateVm(request(IDS.learner));
    await allocator.bindSession(vm.id, "ses-123");
    const row = fakeSupabase().tables["vm_pool_entries"]?.find((entry) => entry["id"] === vm.id);
    expect(row?.["current_session_id"]).toBe("ses-123");
  });

  it("clears the lease once the session owns the machine", async () => {
    const allocator = await freshPool(1);
    const vm = await allocator.allocateVm(request(IDS.learner));
    await allocator.clearAllocationLease(vm.id);
    const row = fakeSupabase().tables["vm_pool_entries"]?.find((entry) => entry["id"] === vm.id);
    expect(row?.["allocation_expires_at"]).toBeNull();
  });

  it("renews the lease while a launch is still running", async () => {
    const allocator = await freshPool(1);
    const vm = await allocator.allocateVm(request(IDS.learner));
    const before = fakeSupabase().tables["vm_pool_entries"]?.[0]?.["allocation_expires_at"] as string;
    await allocator.renewAllocationLease(vm.id, 1800);
    const after = fakeSupabase().tables["vm_pool_entries"]?.[0]?.["allocation_expires_at"] as string;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("surfaces an elapsed lease as a stale allocation", async () => {
    const allocator = await freshPool(1);
    const vm = await allocator.allocateVm(request(IDS.learner));
    const row = fakeSupabase().tables["vm_pool_entries"]?.find((entry) => entry["id"] === vm.id);
    if (row) row["allocation_expires_at"] = new Date(Date.now() - 60_000).toISOString();
    const { listStaleAllocations } = await import("@/lib/db/vm-pool.repo.server");
    const stale = await listStaleAllocations();
    expect(stale.map((entry) => entry.id)).toEqual([vm.id]);
  });

  it("does not treat a healthy lease as stale", async () => {
    const allocator = await freshPool(1);
    await allocator.allocateVm(request(IDS.learner));
    const { listStaleAllocations } = await import("@/lib/db/vm-pool.repo.server");
    expect(await listStaleAllocations()).toEqual([]);
  });
});