import { createFileRoute } from "@tanstack/react-router";

/** Single imported template: edit, clone, workspace assignment and delete. */
export const Route = createFileRoute("/api/admin/image-templates/$templateId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const body = (await request.json().catch(() => null)) as
          | (Partial<import("@/lib/cloud/gallery/types").ImageTemplate> & {
              assignWorkspaceId?: string;
              unassignWorkspaceId?: string;
            })
          | null;
        if (!body) return deny("INVALID_REQUEST", "A template update payload is required.");

        const registry = await import("@/lib/cloud/gallery/registry.server");
        const { assignWorkspaceId, unassignWorkspaceId, ...patch } = body;
        let template = registry.getImageTemplate(params.templateId);
        if (!template) return deny("NOT_FOUND", "Template not found.");
        if (assignWorkspaceId) template = registry.assignTemplateToWorkspace(params.templateId, assignWorkspaceId);
        if (unassignWorkspaceId)
          template = registry.unassignTemplateFromWorkspace(params.templateId, unassignWorkspaceId);
        if (Object.keys(patch).length > 0) template = registry.updateImageTemplate(params.templateId, patch);
        return ok({ template });
      },

      POST: async ({ request, params }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const body = (await request.json().catch(() => ({}))) as { name?: string };
        const { cloneImageTemplate } = await import("@/lib/cloud/gallery/registry.server");
        const template = cloneImageTemplate(
          params.templateId,
          body.name?.trim() || "Copy of template",
          guard.context.principal.name ?? guard.context.principal.sub,
        );
        if (!template) return deny("NOT_FOUND", "Template not found.");
        return ok({ template }, 201);
      },

      DELETE: async ({ request, params }) => {
        const { authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;
        const { deleteImageTemplate } = await import("@/lib/cloud/gallery/registry.server");
        if (!deleteImageTemplate(params.templateId)) return deny("NOT_FOUND", "Template not found.");
        return ok({ deleted: true });
      },
    },
  },
});
