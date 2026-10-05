import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const entry = z.object({ key: z.string().max(120), value: z.string().max(500) });

const baseSchema = {
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  cloudProvider: z.string().default("Azure"),
  os: z.string().min(1).max(120),
  vmSize: z.string().min(1).max(120),
  image: z.string().min(1).max(500),
  region: z.string().min(1).max(120),
  configuration: z.array(entry).default([]),
  software: z.array(z.string().max(120)).default([]),
  enabled: z.boolean().default(true),
};

const createSchema = z.object(baseSchema);
const patchSchema = z.object({
  id: z.string().uuid(),
  name: baseSchema.name.optional(),
  description: z.string().max(2000).optional(),
  os: z.string().min(1).max(120).optional(),
  vmSize: z.string().min(1).max(120).optional(),
  image: z.string().min(1).max(500).optional(),
  region: z.string().min(1).max(120).optional(),
  configuration: z.array(entry).optional(),
  software: z.array(z.string().max(120)).optional(),
  enabled: z.boolean().optional(),
});

/** VM template create/update inside the caller's tenant. */
export const Route = createFileRoute("/api/catalog/templates")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, createSchema);
        if ("denied" in body) return body.denied;
        const { createTemplate } = await import("@/lib/db/catalog.write.server");
        return respond(await createTemplate(ctx.tenantId, ctx.principal, body.data));
      },

      PATCH: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, patchSchema);
        if ("denied" in body) return body.denied;
        const { id, ...patch } = body.data;
        const { updateTemplate } = await import("@/lib/db/catalog.write.server");
        return respond(await updateTemplate(ctx.tenantId, ctx.principal, id, patch));
      },
    },
  },
});
