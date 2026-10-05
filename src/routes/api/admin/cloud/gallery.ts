import { createFileRoute } from "@tanstack/react-router";

/**
 * Azure Compute Gallery browsing — administrators only.
 *
 * One read endpoint driving the import wizard. The browser never talks to
 * Azure: every level (resource groups -> galleries -> image definitions ->
 * image versions) is resolved server-side through the selected cloud
 * connection's own credentials.
 */
export const Route = createFileRoute("/api/admin/cloud/gallery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin: authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request);
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const level = url.searchParams.get("level") ?? "connections";
        const connectionId = url.searchParams.get("connectionId") ?? "";
        const resourceGroup = url.searchParams.get("resourceGroup") ?? "";
        const gallery = url.searchParams.get("gallery") ?? "";
        const definition = url.searchParams.get("imageDefinition") ?? "";

        const provider = await import("@/lib/cloud/gallery/provider.server");
        const { AzureConnectionError } = await import("@/lib/cloud/connections/azure-arm.server");

        try {
          switch (level) {
            case "connections":
              return ok({ connections: provider.galleryConnections() });
            case "resource-groups": {
              if (!connectionId) return deny("INVALID_REQUEST", "An Azure connection is required.");
              return ok({ resourceGroups: await provider.listResourceGroups(connectionId) });
            }
            case "galleries": {
              if (!connectionId || !resourceGroup) return deny("INVALID_REQUEST", "A resource group is required.");
              return ok({ galleries: await provider.listComputeGalleries(connectionId, resourceGroup) });
            }
            case "image-definitions": {
              if (!connectionId || !resourceGroup || !gallery)
                return deny("INVALID_REQUEST", "A compute gallery is required.");
              return ok({
                imageDefinitions: await provider.listImageDefinitions(connectionId, resourceGroup, gallery),
              });
            }
            case "image-versions": {
              if (!connectionId || !resourceGroup || !gallery || !definition)
                return deny("INVALID_REQUEST", "An image definition is required.");
              return ok({
                imageVersions: await provider.listImageVersions(connectionId, resourceGroup, gallery, definition),
              });
            }
            default:
              return deny("INVALID_REQUEST", "Unknown gallery request.");
          }
        } catch (error) {
          if (error instanceof AzureConnectionError) {
            const code: import("@/lib/security/types").SecurityErrorCode =
              error.kind === "AUTHENTICATION_ERROR"
                ? "AUTH_INVALID"
                : error.kind === "PERMISSION_ERROR"
                  ? "FORBIDDEN_ROLE"
                  : error.kind === "RESOURCE_GROUP_NOT_FOUND" || error.kind === "SUBSCRIPTION_ERROR"
                    ? "NOT_FOUND"
                    : "UPSTREAM_ERROR";
            return deny(code, error.message);
          }
          console.error("Gallery browse failed:", error);
          return deny("UPSTREAM_ERROR", "Azure could not be reached. Please try again.");
        }
      },
    },
  },
});
