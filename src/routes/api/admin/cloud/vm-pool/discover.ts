import { createFileRoute } from "@tanstack/react-router";

/** Discover candidate Azure VMs in a subscription/resource group (ARM list). */
export const Route = createFileRoute("/api/admin/cloud/vm-pool/discover")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const connectionId = url.searchParams.get("connectionId");
        const resourceGroup = url.searchParams.get("resourceGroup");
        if (!connectionId) return deny("INVALID_REQUEST", "A cloud connection is required.");

        const { discoverVms, PoolError } = await import("@/lib/vm/pool/registry.server");
        const { AzureConnectionError } = await import("@/lib/cloud/connections/azure-arm.server");
        try {
          return ok({ vms: await discoverVms(connectionId, resourceGroup) });
        } catch (error) {
          if (error instanceof PoolError) return deny("INVALID_REQUEST", error.message);
          if (error instanceof AzureConnectionError) return deny("UPSTREAM_ERROR", error.message);
          console.error("VM discovery failed:", error);
          return deny("UPSTREAM_ERROR", "Azure virtual machines could not be listed.");
        }
      },
    },
  },
});
