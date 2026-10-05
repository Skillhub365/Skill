import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Lab launch. The browser supplies a lab id and nothing else that matters:
 * workspace, entitlement, template, image, region, size, provider and duration
 * are all resolved from database records under the authenticated principal.
 * The launch itself lives in `@/lib/launch/launch.server` so agent (MCP) calls
 * take the identical path.
 */
const bodySchema = z.object({
  /** Purely cosmetic client hint; ignored for any authorization decision. */
  clientNote: z.string().max(200).optional(),
  /**
   * Optional client-supplied idempotency key. Two POSTs with the same key
   * (double click, retry after a dropped response) resolve to one session.
   */
  launchKey: z.string().min(8).max(120).optional(),
});

export const Route = createFileRoute("/api/labs/$labId/start")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const { correlationFromRequest } = await import("@/lib/observability/correlation");
        const correlationId = correlationFromRequest("launch", request);

        let body: z.infer<typeof bodySchema>;
        try {
          body = bodySchema.parse(await request.json().catch(() => ({})));
        } catch {
          return deny("INVALID_REQUEST");
        }

        const guard = await authorize(request, { labId: params.labId });
        if ("denied" in guard) return guard.denied;
        const principal = guard.context.principal;

        const { launchLab } = await import("@/lib/launch/launch.server");
        const outcome = await launchLab({
          labId: params.labId,
          principal,
          launchKey: request.headers.get("idempotency-key") ?? body.launchKey ?? undefined,
          correlationId,
          channel: "web",
        });

        if (!outcome.ok) return deny(outcome.code, outcome.detail);
        return Response.json(
          {
            sessionId: outcome.sessionId,
            session: outcome.session,
            vm: outcome.vm,
            ...(outcome.reused ? { reused: true } : {}),
          },
          { headers: { "Cache-Control": "no-store", "x-correlation-id": correlationId } },
        );
      },
    },
  },
});
