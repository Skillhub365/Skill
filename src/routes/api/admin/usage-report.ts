import { createFileRoute } from "@tanstack/react-router";

/**
 * Usage and estimated-cost reporting for administrators.
 * `?format=csv` returns a downloadable export of the same figures.
 * Regular admins see their own organisation; super admins see the platform.
 */
export const Route = createFileRoute("/api/admin/usage-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const url = new URL(request.url);
        const windowDays = Math.min(365, Math.max(1, Number(url.searchParams.get("windowDays") ?? 30) || 30));
        const isSuperAdmin = guard.context.principal.role === "superadmin";
        const tenantId = isSuperAdmin ? null : ((guard.context.principal as { tenantId?: string | null }).tenantId ?? null);

        const { usageReport } = await import("@/lib/reporting/usage.server");
        const report = await usageReport({ windowDays, tenantId });

        if (url.searchParams.get("format") === "csv") {
          const rows: string[] = ["dimension,name,sessions,vm_hours,estimated_cost_usd"];
          const push = (dimension: string, buckets: typeof report.byWorkspace) => {
            for (const bucket of buckets) {
              const name = `"${bucket.label.replace(/"/g, '""')}"`;
              rows.push(
                `${dimension},${name},${bucket.sessions},${bucket.vmHours.toFixed(2)},${(bucket.estimatedCostCents / 100).toFixed(2)}`,
              );
            }
          };
          push("workspace", report.byWorkspace);
          push("lab", report.byLab);
          push("learner", report.byUser);
          push("vm_size", report.bySize);
          return new Response(rows.join("\n"), {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="skilltrack-usage-${windowDays}d.csv"`,
              "cache-control": "no-store",
            },
          });
        }

        return ok(report);
      },
    },
  },
});
