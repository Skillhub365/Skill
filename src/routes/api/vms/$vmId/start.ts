import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vms/$vmId/start")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { authorize, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { vmId: params.vmId });
        if ("denied" in guard) return guard.denied;
        const { orchestrator } = await import("@/lib/vm/orchestrator.server");
        let body: { durationMinutes?: number; snapshot?: unknown } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          /* empty body is fine */
        }
        const duration = typeof body.durationMinutes === "number" ? Math.min(Math.max(body.durationMinutes, 5), 480) : 60;
        try {
          const vm = await orchestrator.startVM(params.vmId, {
            durationMinutes: duration,
            ...(body.snapshot ? { adopt: body.snapshot as never } : {}),
          });
          return Response.json({ vm }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return deny("VM_START_FAILED");
        }
      },
    },
  },
});