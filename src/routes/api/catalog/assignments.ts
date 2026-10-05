import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  labId: z.string().uuid(),
});

const accessSchema = schema.extend({
  accessStartsAt: z.string().datetime().nullable().optional(),
  accessEndsAt: z.string().datetime().nullable().optional(),
  allowedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  addMinutes: z.number().int().min(-100_000).max(100_000).optional(),
  extendDays: z.number().int().min(0).max(365).optional(),
  status: z.enum(["assigned", "revoked"]).optional(),
  reset: z.boolean().optional(),
});

/** Toggle a learner's assignment, and manage persistent-lab access grants. */
export const Route = createFileRoute("/api/catalog/assignments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, schema);
        if ("denied" in body) return body.denied;
        const { toggleAssignment } = await import("@/lib/db/catalog.write.server");
        return respond(
          await toggleAssignment(ctx.tenantId, ctx.principal, body.data.workspaceId, body.data.userId, body.data.labId),
        );
      },

      PATCH: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, accessSchema);
        if ("denied" in body) return body.denied;
        const { reset, ...input } = body.data;

        if (reset) {
          const { findAssignment, resetPersistentAssignment } = await import("@/lib/labs/persistent-vm.server");
          const grant = await findAssignment(input.labId, input.userId);
          if (!grant) return respond({ ok: false, reason: "NOT_FOUND" as const });
          await resetPersistentAssignment(grant.id, `admin:${ctx.principal.sub}`);
        }

        const { setAssignmentAccess } = await import("@/lib/db/catalog.write.server");
        return respond(await setAssignmentAccess(ctx.tenantId, ctx.principal, input));
      },
    },
  },
});
