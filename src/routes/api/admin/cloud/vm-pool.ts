import { createFileRoute } from "@tanstack/react-router";

/**
 * VM pool management — Super Admin only.
 * GET  lists registered Azure VMs, per-template capacity and import options.
 * POST registers a discovered Azure VM against a SkillTrack image template.
 */
export const Route = createFileRoute("/api/admin/cloud/vm-pool")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;
        const registry = await import("@/lib/vm/pool/registry.server");
        const { dynamicProvisioningEnabled } = await import("@/lib/vm/pool/provider.server");
        const { ensureReaper, lastReaperRun } = await import("@/lib/vm/pool/reaper.server");
        const { poolVmKind, poolRuntimeBadge } = await import("@/lib/vm/pool/admin-ops.server");
        const { poolVmForClient } = await import("@/lib/vm/pool/types");
        ensureReaper();
        await registry.detectOrphans();

        const vms = registry.listPoolVms();
        // The console needs to distinguish real Azure capacity from samples.
        const kinds = Object.fromEntries(vms.map((vm) => [vm.id, poolVmKind(vm)]));

        // Workspace picker for pinning capacity; names only, no tenant detail.
        let workspaces: { id: string; name: string }[] = [];
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("workspaces")
            .select("id, name")
            .order("name", { ascending: true });
          workspaces = data ?? [];
        } catch (error) {
          console.error("[vm-pool] workspace options unavailable:", error);
        }

        return ok({
          vms: vms.map(poolVmForClient),
          summaries: registry.poolSummaries(),
          templates: registry.templateOptions(),
          dynamicProvisioning: dynamicProvisioningEnabled(),
          reaper: lastReaperRun(),
          kinds,
          runtime: await poolRuntimeBadge(),
          workspaces,
        });
      },

      POST: async ({ request }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;

        const body = (await request.json().catch(() => null)) as
          | import("@/lib/vm/pool/types").RegisterVmDraft
          | null;
        if (!body?.cloudConnectionId || !body.resourceGroup || !body.azureVmName || !body.templateId) {
          return deny("INVALID_REQUEST", "Connection, resource group, VM and template are required.");
        }

        const { registerVm, PoolError } = await import("@/lib/vm/pool/registry.server");
        const { AzureConnectionError } = await import("@/lib/cloud/connections/azure-arm.server");
        try {
          const vm = await registerVm(body, guard.context.principal.name ?? guard.context.principal.sub);
          return ok({ vm }, 201);
        } catch (error) {
          if (error instanceof PoolError) return deny("INVALID_REQUEST", error.message);
          if (error instanceof AzureConnectionError) return deny("UPSTREAM_ERROR", error.message);
          console.error("VM pool registration failed:", error);
          return deny("UPSTREAM_ERROR", "The virtual machine could not be registered.");
        }
      },
    },
  },
});
