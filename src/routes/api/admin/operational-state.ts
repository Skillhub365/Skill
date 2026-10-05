import { createFileRoute } from "@tanstack/react-router";

/** Live operational snapshot: sessions, stuck launches, orphans, capacity, budget. */
export const Route = createFileRoute("/api/admin/operational-state")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const { operationalSnapshot } = await import("@/lib/observability/operational-state.server");
        return Response.json(await operationalSnapshot(), { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
