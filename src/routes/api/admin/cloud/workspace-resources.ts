import { createFileRoute } from "@tanstack/react-router";

/**
 * Workspace-scoped Azure view.
 *
 * Returns only the connection and resource group the workspace is explicitly
 * mapped to, and only the virtual machines inside that resource group. A
 * workspace can never see another workspace's subscription or resources.
 */
export const Route = createFileRoute("/api/admin/cloud/workspace-resources")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const url = new URL(request.url);
        const workspaceId = url.searchParams.get("workspaceId") ?? "";
        if (!workspaceId) return deny("INVALID_REQUEST", "A workspace is required.");

        // Scoped by workspace membership as well as capability.
        const guard = await authorize(request, { workspaceId, capability: "cloud:read" });
        if ("denied" in guard) return guard.denied;

        const { connectionForWorkspace, getInventory } = await import(
          "@/lib/cloud/connections/registry.server"
        );
        const { ensureRefreshScheduler } = await import("@/lib/cloud/connections/scheduler.server");
        ensureRefreshScheduler();

        const bound = await connectionForWorkspace(workspaceId);
        if (!bound) return ok({ mapped: false, scope: null, virtualMachines: [], schedule: ensureRefreshScheduler() });

        const resourceGroup = bound.link.resourceGroup || bound.connection.defaultResourceGroup || "";
        const inventory = getInventory(bound.connection.id);
        const virtualMachines = (inventory?.virtualMachines ?? []).filter(
          (vm) => !resourceGroup || vm.resourceGroup.toLowerCase() === resourceGroup.toLowerCase(),
        );

        return ok({
          mapped: true,
          scope: {
            workspaceId,
            connectionId: bound.connection.id,
            connectionName: bound.connection.name,
            provider: bound.connection.provider,
            subscriptionId: bound.connection.subscriptionId,
            subscriptionName: bound.connection.subscriptionName,
            resourceGroup,
            region: bound.link.defaultRegion || bound.connection.defaultRegion || "",
            status: bound.connection.status,
            linkedAt: bound.link.linkedAt,
            lastSyncAt: inventory?.syncedAt ?? bound.connection.lastSyncAt,
          },
          virtualMachines,
          schedule: ensureRefreshScheduler(),
        });
      },
    },
  },
});
