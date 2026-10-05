import { createFileRoute } from "@tanstack/react-router";

/**
 * Imported Azure Compute Gallery templates — administrators only.
 * GET  lists SkillTrack VM templates created from gallery images.
 * POST imports a new template (stores references only, never image data).
 */
export const Route = createFileRoute("/api/admin/image-templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const { listImageTemplates } = await import("@/lib/cloud/gallery/registry.server");
        return ok({ templates: listImageTemplates() });
      },

      POST: async ({ request }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const body = (await request.json().catch(() => null)) as
          | import("@/lib/cloud/gallery/types").ImageTemplateDraft
          | null;
        if (!body?.name || !body.cloudConnectionId || !body.resourceGroupName || !body.galleryName || !body.imageDefinitionName) {
          return deny("INVALID_REQUEST", "Connection, resource group, gallery, image definition and name are required.");
        }
        if (body.versionPolicy === "pinned" && !body.imageVersion) {
          return deny("INVALID_REQUEST", "Select an image version or use the latest-version policy.");
        }

        const { importImageTemplate, ImportError } = await import("@/lib/cloud/gallery/registry.server");
        const { AzureConnectionError } = await import("@/lib/cloud/connections/azure-arm.server");
        try {
          const template = await importImageTemplate(
            body,
            guard.context.principal.name ?? guard.context.principal.sub,
          );
          return ok({ template }, 201);
        } catch (error) {
          if (error instanceof ImportError) return deny("NOT_FOUND", error.message);
          if (error instanceof AzureConnectionError) return deny("UPSTREAM_ERROR", error.message);
          console.error("Image template import failed:", error);
          return deny("UPSTREAM_ERROR", "The image could not be imported. Please try again.");
        }
      },
    },
  },
});
