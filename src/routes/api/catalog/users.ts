import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const role = z.enum(["superadmin", "admin", "user"]);
const accountStatus = z.enum(["active", "invited", "suspended"]);

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).max(120),
    email: z.string().email().max(200),
    role,
    status: accountStatus.default("invited"),
  }),
  z.object({
    action: z.literal("update"),
    id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    role: role.optional(),
    status: accountStatus.optional(),
  }),
  z.object({ action: z.literal("remove"), id: z.string().uuid() }),
]);

/** Tenant user administration. Creating a superadmin requires superadmin. */
export const Route = createFileRoute("/api/catalog/users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const body0 = request.clone();
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(body0, schema);
        if ("denied" in body) return body.denied;
        const input = body.data;

        const wantsSuperadmin = "role" in input && input.role === "superadmin";
        if (wantsSuperadmin && ctx.principal.role !== "superadmin") {
          const { deny } = await import("@/lib/security/guard.server");
          return deny("FORBIDDEN_ROLE", "Only a super admin can grant the super admin role");
        }

        const repo = await import("@/lib/db/catalog.write.server");
        switch (input.action) {
          case "create":
            return respond(await repo.createManagedUser(ctx.tenantId, ctx.principal, input));
          case "update": {
            const { id, action: _action, ...patch } = input;
            return respond(await repo.updateManagedUser(ctx.tenantId, ctx.principal, id, patch));
          }
          case "remove":
            return respond(await repo.removeManagedUser(ctx.tenantId, ctx.principal, input.id));
        }
      },
    },
  },
});
