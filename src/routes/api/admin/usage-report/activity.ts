import { createFileRoute } from "@tanstack/react-router";

/**
 * Unified activity feed (user / VM / admin) sourced from the durable
 * activity_logs, session_events and lifecycle_events tables.
 */
export const Route = createFileRoute("/api/admin/usage-report/activity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const principal = guard.context.principal as { role: string; tenantId?: string | null };
        const isSuper = principal.role === "superadmin";
        const url = new URL(request.url);
        const q = (key: string) => url.searchParams.get(key) || null;

        const { activityFeed } = await import("@/lib/reporting/usage-detail.server");
        const stream = q("stream");
        const feed = await activityFeed({
          from: q("from"),
          to: q("to"),
          tenantId: isSuper ? q("tenantId") : (principal.tenantId ?? null),
          workspaceId: q("workspaceId"),
          labId: q("labId"),
          userId: q("userId"),
          stream: stream === "user" || stream === "vm" || stream === "admin" ? stream : null,
          limit: Number(q("limit") ?? 300) || 300,
        });

        if (url.searchParams.get("format") === "csv") {
          const esc = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
          const lines = ["at,stream,source,action,actor,target,outcome,detail,correlation_id"];
          for (const r of feed.rows) {
            lines.push([
              esc(r.at), esc(r.stream), esc(r.source), esc(r.action), esc(r.actor),
              esc(r.target), esc(r.outcome), esc(r.detail), esc(r.correlationId),
            ].join(","));
          }
          return new Response(lines.join("\n"), {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="skilltrack-activity-${feed.from.slice(0, 10)}_${feed.to.slice(0, 10)}.csv"`,
              "cache-control": "no-store",
            },
          });
        }

        return ok(feed);
      },
    },
  },
});
