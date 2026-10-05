import { createFileRoute } from "@tanstack/react-router";

/**
 * Azure reconciliation and live-integration status.
 *
 * GET  — per-connection Event Grid status, drift counts and the last summary.
 * POST — run a reconciliation pass now (Super Admin only).
 */
export const Route = createFileRoute("/api/admin/cloud/reconcile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorizeCloudAdmin, ok } = await import("@/lib/security/guard.server");
        const guard = await authorizeCloudAdmin(request, "cloud:read");
        if ("denied" in guard) return guard.denied;

        const { listConnections } = await import("@/lib/cloud/connections/registry.server");
        const registry = await import("@/lib/vm/pool/registry.server");
        const { connectionEventStatus, eventGridConfigured } = await import("@/lib/cloud/events/status.server");
        const { ensureReconciler, lastReconcileSummary } = await import("@/lib/cloud/events/reconcile.server");
        ensureReconciler();
        await registry.ensurePoolLoaded();

        const vms = registry.listPoolVms();
        const statuses = listConnections().map((c) =>
          connectionEventStatus(c.id, c.name, {
            lastSyncAt: c.lastSyncAt,
            driftCount: vms.filter((v) => v.cloudConnectionId === c.id && (v.driftDetected || v.azureMissing)).length,
          }),
        );
        return ok({
          eventGridConfigured: eventGridConfigured(),
          statuses,
          lastReconcile: lastReconcileSummary(),
        });
      },

      POST: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;
        const { reconcileOnce } = await import("@/lib/cloud/events/reconcile.server");
        const summary = await reconcileOnce(guard.context.principal.name ?? guard.context.principal.sub);
        return ok({ summary });
      },
    },
  },
});