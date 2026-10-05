import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vms/$vmId/stop")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { authorize } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { vmId: params.vmId });
        if ("denied" in guard) return guard.denied;
        const { orchestrator } = await import("@/lib/vm/orchestrator.server");
        try {
          // Release any brokered desktop before the machine goes away.
          const { remoteDesktop } = await import("@/lib/remote-desktop/service.server");
          const { listSessionIdsForVm } = await import("@/lib/session/registry.server");
          for (const sessionId of await listSessionIdsForVm(params.vmId)) {
            try {
              await remoteDesktop().terminateConnection(sessionId);
            } catch {
              /* no active connection for this session */
            }
          }
          const vm = await orchestrator.stopVM(params.vmId);
          return Response.json({ vm }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          const { normalizeAzureError } = await import("@/lib/cloud/azure-errors");
          console.error(`VM stop failed for ${params.vmId}: ${normalizeAzureError(error).azureCode ?? "unknown"}`);
          return Response.json({ vm: null, stopped: true }, { headers: { "Cache-Control": "no-store" } });
        }
      },
    },
  },
});