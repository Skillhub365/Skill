import { createFileRoute } from "@tanstack/react-router";

/**
 * Workspace -> cloud connection bindings. A workspace has no cloud access
 * until it is explicitly bound to one connection, resource group and region.
 */
export const Route = createFileRoute("/api/admin/cloud/workspace-links")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;
        const { listWorkspaceLinks, listConnections } = await import("@/lib/cloud/connections/registry.server");
        return ok({ links: listWorkspaceLinks(), connections: listConnections() });
      },

      PUT: async ({ request }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;
        const body = (await request.json().catch(() => null)) as
          | { workspaceId: string; cloudConnectionId: string; resourceGroup?: string; defaultRegion?: string; status?: "active" | "suspended" }
          | null;
        if (!body?.workspaceId || !body.cloudConnectionId) {
          return deny("INVALID_REQUEST", "workspaceId and cloudConnectionId are required.");
        }
        const { getConnection, setWorkspaceLink } = await import("@/lib/cloud/connections/registry.server");
        const connection = getConnection(body.cloudConnectionId);
        if (!connection) return deny("NOT_FOUND", "Cloud connection not found.");
        const link = setWorkspaceLink({
          workspaceId: body.workspaceId,
          cloudConnectionId: body.cloudConnectionId,
          resourceGroup: body.resourceGroup?.trim() || connection.defaultResourceGroup || "",
          defaultRegion: body.defaultRegion?.trim() || connection.defaultRegion || "",
          status: body.status ?? "active",
        });
        recordCloudAudit({
          action: "workspace.link",
          outcome: "success",
          actor: guard.context.principal,
          connectionId: connection.id,
          connectionName: connection.name,
          subscriptionId: connection.subscriptionId,
          workspaceId: link.workspaceId,
          resourceGroup: link.resourceGroup,
        });
        return ok({ link });
      },

      DELETE: async ({ request }) => {
        const { authorizeCloudAdmin, ok, deny } = await import("@/lib/security/guard.server");
        const { recordCloudAudit } = await import("@/lib/cloud/audit/audit-log.server");
        const guard = await authorizeCloudAdmin(request);
        if ("denied" in guard) return guard.denied;
        const workspaceId = new URL(request.url).searchParams.get("workspaceId");
        if (!workspaceId) return deny("INVALID_REQUEST", "workspaceId is required.");
        const { removeWorkspaceLink } = await import("@/lib/cloud/connections/registry.server");
        const removed = removeWorkspaceLink(workspaceId);
        recordCloudAudit({
          action: "workspace.unlink",
          outcome: removed ? "success" : "failure",
          actor: guard.context.principal,
          workspaceId,
          errorCode: removed ? null : "NOT_FOUND",
        });
        return ok({ removed });
      },
    },
  },
});
