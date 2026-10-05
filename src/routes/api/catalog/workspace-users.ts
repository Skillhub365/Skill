import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), workspaceId: z.string().uuid(), userId: z.string().uuid() }),
  z.object({ action: z.literal("remove"), membershipId: z.string().uuid() }),
  z.object({
    action: z.literal("status"),
    membershipId: z.string().uuid(),
    status: z.enum(["active", "invited", "suspended"]),
  }),
  z.object({
    action: z.literal("capabilities"),
    workspaceId: z.string().uuid(),
    userId: z.string().uuid(),
    capabilities: z.array(z.string().max(60)).max(32),
  }),
]);

/** Workspace membership and per-workspace capability grants. */
export const Route = createFileRoute("/api/catalog/workspace-users")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { adminContext, parseBody, respond } = await import("@/lib/db/catalog.api.server");
        const ctx = await adminContext(request);
        if ("denied" in ctx) return ctx.denied;
        const body = await parseBody(request, schema);
        if ("denied" in body) return body.denied;
        const input = body.data;
        const repo = await import("@/lib/db/catalog.write.server");

        switch (input.action) {
          case "add":
            return respond(await repo.addWorkspaceUser(ctx.tenantId, ctx.principal, input.workspaceId, input.userId));
          case "remove":
            return respond(await repo.removeWorkspaceUser(ctx.tenantId, ctx.principal, input.membershipId));
          case "status":
            return respond(await repo.setWorkspaceUserStatus(ctx.tenantId, input.membershipId, input.status));
          case "capabilities":
            return respond(
              await repo.setUserCapabilities(
                ctx.tenantId,
                ctx.principal,
                input.workspaceId,
                input.userId,
                input.capabilities as never,
              ),
            );
        }
      },
    },
  },
});
