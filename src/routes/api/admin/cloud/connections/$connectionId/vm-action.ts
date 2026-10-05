import { createFileRoute } from "@tanstack/react-router";

/**
 * Start, deallocate or read a virtual machine in one subscription.
 * Only an admin holding "vm:manage" may change power state; every attempt is
 * audited with the actor, target and a normalized error code.
 */
export const Route = createFileRoute("/api/admin/cloud/connections/$connectionId/vm-action")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const audit = await import("@/lib/cloud/audit/audit-log.server");

        const body = (await request.json().catch(() => null)) as
          | { action?: "start" | "stop" | "status"; resourceGroup?: string; vmName?: string }
          | null;
        const action = body?.action ?? "status";
        const auditAction =
          action === "start" ? "vm.start" : action === "stop" ? "vm.deallocate" : "vm.status";

        const guard = await authorizeCloudAdmin(request, action === "status" ? "cloud:read" : "vm:manage");
        if ("denied" in guard) {
          audit.recordCloudAudit({
            action: auditAction,
            outcome: "denied",
            actor: { sub: "anonymous", role: "unknown" },
            connectionId: params.connectionId,
            resourceGroup: body?.resourceGroup ?? null,
            target: body?.vmName ?? null,
            errorCode: "FORBIDDEN_ROLE",
          });
          return guard.denied;
        }

        if (!body?.resourceGroup || !body.vmName) {
          return deny("INVALID_REQUEST", "A resource group and virtual machine name are required.");
        }

        const { getConnection } = await import("@/lib/cloud/connections/registry.server");
        const connection = getConnection(params.connectionId);
        if (!connection) return deny("NOT_FOUND", "Cloud connection not found.");

        const { multiCloudController } = await import("@/lib/cloud/connections/controller.server");
        const context = {
          action: auditAction as "vm.start" | "vm.deallocate" | "vm.status",
          actor: guard.context.principal,
          connectionId: connection.id,
          connectionName: connection.name,
          subscriptionId: connection.subscriptionId,
          resourceGroup: body.resourceGroup,
          target: body.vmName,
        };

        try {
          const vm = await audit.auditedCloudOperation(context, async () => {
            if (action === "start")
              return multiCloudController.startVM(connection.id, body.resourceGroup!, body.vmName!);
            if (action === "stop")
              return multiCloudController.stopVM(connection.id, body.resourceGroup!, body.vmName!);
            return multiCloudController.vmStatus(connection.id, body.resourceGroup!, body.vmName!);
          });
          return ok({ vm });
        } catch {
          return deny(action === "start" ? "VM_START_FAILED" : "UPSTREAM_ERROR", "The Azure request did not complete.");
        }
      },
    },
  },
});
