import { createFileRoute } from "@tanstack/react-router";

/**
 * Single pooled VM: sync real Azure state, reclaim an orphan, or remove the
 * registration. Every action is audited; the browser never calls Azure.
 */
export const Route = createFileRoute("/api/admin/cloud/vm-pool/$vmId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;

        const body = (await request.json().catch(() => null)) as { action?: string } | null;
        const action = body?.action;
        const registry = await import("@/lib/vm/pool/registry.server");
        const vm = registry.getPoolVm(params.vmId);
        if (!vm) return deny("NOT_FOUND", "This machine is not registered in the pool.");
        const actor = guard.context.principal.name ?? guard.context.principal.sub;

        try {
          const admin = await import("@/lib/vm/pool/admin-ops.server");
          const { poolVmForClient } = await import("@/lib/vm/pool/types");
          const safe = (v: unknown) => (v ? poolVmForClient(v as never) : null);

          if (action === "sync") return ok({ vm: safe(await registry.syncVm(vm.id)) });
          if (action === "start") return ok({ vm: safe(await admin.adminStartVm(vm.id, actor)) });
          if (action === "stop") return ok({ vm: safe(await admin.adminStopVm(vm.id, actor)) });
          if (action === "restart") {
            const { vm: updated, strategy } = await admin.adminRestartVm(vm.id, actor);
            return ok({ vm: safe(updated), message: strategy });
          }
          if (action === "test-azure") return ok({ test: await admin.testAzureState(vm.id, actor) });
          if (action === "test-rdp") return ok({ rdp: await admin.testRdpReadiness(vm.id, actor) });
          if (action === "retire") return ok({ vm: safe(await admin.adminRetireVm(vm.id, actor, true)) });
          if (action === "restore") return ok({ vm: safe(await admin.adminRetireVm(vm.id, actor, false)) });
          if (action === "assign-workspace" || action === "workspace") {
            const workspaceId = (body as { workspaceId?: string | null } | null)?.workspaceId ?? null;
            return ok({ vm: safe(await admin.adminAssignWorkspace(vm.id, actor, workspaceId)) });
          }
          if (action === "assign-user-lab") {
            const input = (body ?? {}) as {
              userId?: string | null;
              userName?: string | null;
              labId?: string | null;
              workspaceId?: string | null;
            };
            return ok({
              vm: safe(
                await admin.adminAssignUserLab(vm.id, actor, {
                  userId: input.userId ?? null,
                  userName: input.userName ?? null,
                  labId: input.labId ?? null,
                  ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
                }),
              ),
            });
          }
          if (action === "release") {
            const { stopAndRelease } = await import("@/lib/vm/pool/reaper.server");
            return ok({ vm: safe(await stopAndRelease(vm.id, actor)) });
          }
          if (action === "reclaim") {
            const { poolProvider } = await import("@/lib/vm/pool/provider.server");
            await poolProvider().stopVM(vm.id);
            await registry.syncVm(vm.id);
            await registry.audit("vmpool.reclaim", actor, vm, `Reclaimed orphaned VM ${vm.azureVmName}.`);
            return ok({ vm: safe(registry.getPoolVm(vm.id)) });
          }
          return deny("INVALID_REQUEST", "Unknown VM pool action.");
        } catch (error) {
          if (error instanceof registry.PoolError) return deny("INVALID_REQUEST", error.message);
          console.error("VM pool action failed:", error);
          return deny("UPSTREAM_ERROR", "The action could not be completed.");
        }
      },

      DELETE: async ({ request, params }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;
        const registry = await import("@/lib/vm/pool/registry.server");
        try {
          const removed = await registry.removeVm(
            params.vmId,
            guard.context.principal.name ?? guard.context.principal.sub,
          );
          if (!removed) return deny("NOT_FOUND", "This machine is not registered in the pool.");
          return ok({ removed: true });
        } catch (error) {
          if (error instanceof registry.PoolError) return deny("INVALID_REQUEST", error.message);
          return deny("UPSTREAM_ERROR", "The machine could not be removed.");
        }
      },
    },
  },
});
