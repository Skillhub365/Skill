import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const level = z.enum(["Beginner", "Intermediate", "Advanced"]);
const labStatus = z.enum(["draft", "published", "unpublished"]);
const labMode = z.enum(["session_based", "persistent"]);
const persistencePolicy = z.enum(["keep_vm", "keep_disk", "snapshot_restore"]);

const persistenceFields = {
  labMode: labMode.optional(),
  maxExtensions: z.number().int().min(0).max(20).optional(),
  defaultAccessDays: z.number().int().min(1).max(365).optional(),
  defaultAllowedMinutes: z.number().int().min(15).max(100_000).optional(),
  idleShutdownMinutes: z.number().int().min(5).max(480).optional(),
  persistencePolicy: persistencePolicy.optional(),
  resetOnAccessEnd: z.boolean().optional(),
};

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  objectives: z.array(z.string().max(500)).default([]),
  workspaceId: z.string().uuid(),
  templateId: z.string().default(""),
  durationMinutes: z.number().int().min(5).max(1440),
  level,
  status: labStatus.default("draft"),
  tags: z.array(z.string().max(60)).default([]),
  ...persistenceFields,
});

const patchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  objectives: z.array(z.string().max(500)).optional(),
  workspaceId: z.string().uuid().optional(),
  templateId: z.string().optional(),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  level: level.optional(),
  status: labStatus.optional(),
  tags: z.array(z.string().max(60)).optional(),
  ...persistenceFields,
});

/** Lab authoring, publishing and unpublishing. */
export const Route = createFileRoute("/api/catalog/labs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, createSchema);
        if ("denied" in body) return body.denied;
        const { createLab } = await import("@/lib/db/catalog.write.server");
        return respond(await createLab(ctx.tenantId, ctx.principal, body.data));
      },

      PATCH: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, patchSchema);
        if ("denied" in body) return body.denied;
        const { id, ...patch } = body.data;
        const { updateLab } = await import("@/lib/db/catalog.write.server");
        return respond(await updateLab(ctx.tenantId, ctx.principal, id, patch));
      },
    },
  },
});
