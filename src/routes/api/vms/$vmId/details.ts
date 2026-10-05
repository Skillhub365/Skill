import { createFileRoute } from "@tanstack/react-router";

/**
 * CloudController.getVMDetails() — administrators only.
 *
 * Returns the SkillTrack -> Azure resource mapping with the subscription ID
 * masked. Credentials, private IPs and gateway secrets are never included.
 */
export const Route = createFileRoute("/api/vms/$vmId/details")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { authorize, deny, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { vmId: params.vmId });
        if ("denied" in guard) return guard.denied;
        const isAdmin = guard.context.principal.role === "admin";
        const { cloudController } = await import("@/lib/cloud/controller.server");
        const details = await cloudController.getVMDetails(params.vmId, { includeCloudMapping: isAdmin });
        if (!details) return deny("VM_UNAVAILABLE");
        // Administrators also see the normalised provider runtime view.
        let instanceView = null;
        if (isAdmin) {
          try {
            instanceView = await cloudController.getVMInstanceView(params.vmId);
          } catch {
            instanceView = null;
          }
        }
        return ok({ details, instanceView });
      },
    },
  },
});