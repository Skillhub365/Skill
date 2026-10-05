import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const accessType = z.enum(["WORKSPACE_URL", "USER_SESSION_URL"]);
const status = z.enum(["published", "draft", "archived"]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  org: z.string().min(1).max(120),
  templateId: z.string().default(""),
  accessType,
  publicLanding: z.boolean().default(false),
  enabled: z.boolean().default(true),
  status: status.default("draft"),
  slug: z.string().max(120).optional(),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  org: z.string().min(1).max(120).optional(),
  templateId: z.string().optional(),
  accessType: accessType.optional(),
  publicLanding: z.boolean().optional(),
  enabled: z.boolean().optional(),
  status: status.optional(),
  slug: z.string().max(120).optional(),
  regenerateSlug: z.boolean().optional(),
});

/** Workspace create/update. Tenant and actor come from the verified session. */
export const Route = createFileRoute("/api/catalog/workspaces")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, createSchema);
        if ("denied" in body) return body.denied;
        const { createWorkspace } = await import("@/lib/db/catalog.write.server");
        return respond(await createWorkspace(ctx.tenantId, ctx.principal, body.data));
      },

      PATCH: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, patchSchema);
        if ("denied" in body) return body.denied;
        const { id, ...patch } = body.data;
        const { updateWorkspace } = await import("@/lib/db/catalog.write.server");
        return respond(await updateWorkspace(ctx.tenantId, ctx.principal, id, patch));
      },
    },
  },
});
