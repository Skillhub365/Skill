import { createFileRoute } from "@tanstack/react-router";

/**
 * Session-level usage detail. Admins are pinned to their own organisation;
 * only a Super Admin may pass `tenantId` or read across tenants.
 * `?format=csv` / `?format=json` return downloadable exports.
 */
export const Route = createFileRoute("/api/admin/usage-report/sessions")({
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

        const tenantId = isSuper ? q("tenantId") : (principal.tenantId ?? null);

        const { sessionUsage } = await import("@/lib/reporting/usage-detail.server");
        const report = await sessionUsage({
          from: q("from"),
          to: q("to"),
          tenantId,
          workspaceId: q("workspaceId"),
          labId: q("labId"),
          userId: q("userId"),
          vm: q("vm"),
          status: q("status"),
          limit: Number(q("limit") ?? 1000) || 1000,
        });

        let tenants: Array<{ id: string; name: string }> = [];
        if (isSuper) {
          try {
            const { db } = await import("@/lib/db/client.server");
            const supabase = await db();
            const { data } = await supabase.from("tenants").select("id, name").order("name").limit(200);
            tenants = (data ?? []).map((t) => ({ id: String(t.id), name: String(t.name) }));
          } catch {
            tenants = [];
          }
        }

        const format = url.searchParams.get("format");
        const stamp = `${report.from.slice(0, 10)}_${report.to.slice(0, 10)}`;

        if (format === "csv") {
          const head = [
            "session_id","learner","learner_email","workspace","lab","vm_name","azure_resource_id","vm_size","region",
            "started_at","ended_at","duration_minutes","status","assignment_type","persistent_remaining_hours","persistent_allowed_hours","access_ends_at","estimated_cost_usd","correlation_id",
          ];
          const esc = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
          const lines = [head.join(",")];
          for (const r of report.rows) {
            lines.push([
              esc(r.sessionId), esc(r.learnerName), esc(r.learnerEmail), esc(r.workspace), esc(r.lab),
              esc(r.vmName), esc(r.azureResourceId), esc(r.vmSize), esc(r.region), esc(r.startedAt),
              esc(r.endedAt), r.durationMinutes, esc(r.status), esc(r.assignmentType),
              esc(r.persistentRemainingHours), esc(r.persistentAllowedHours), esc(r.accessEndsAt),
              (r.estimatedCostCents / 100).toFixed(2), esc(r.correlationId),
            ].join(","));
          }
          return new Response(lines.join("\n"), {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="skilltrack-usage-sessions-${stamp}.csv"`,
              "cache-control": "no-store",
            },
          });
        }

        if (format === "json") {
          return new Response(JSON.stringify({ ...report, tenants }, null, 2), {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "content-disposition": `attachment; filename="skilltrack-usage-sessions-${stamp}.json"`,
              "cache-control": "no-store",
            },
          });
        }

        return ok({ ...report, tenants, scope: isSuper ? "platform" : "tenant" });
      },
    },
  },
});
