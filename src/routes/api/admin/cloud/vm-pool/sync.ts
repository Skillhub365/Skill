import { createFileRoute } from "@tanstack/react-router";

/** Refresh every registered machine against Azure and flag orphans. */
export const Route = createFileRoute("/api/admin/cloud/vm-pool/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "superadmin" });
        if ("denied" in guard) return guard.denied;
        const registry = await import("@/lib/vm/pool/registry.server");
        const { ensureReaper, reapOnce } = await import("@/lib/vm/pool/reaper.server");
        ensureReaper();
        await registry.syncAll();
        // Sweep expired sessions and release their machines before reporting.
        const reaper = await reapOnce(guard.context.principal.name ?? guard.context.principal.sub);
        const orphans = await registry.detectOrphans();
        return ok({
          vms: registry.listPoolVms(),
          summaries: registry.poolSummaries(),
          orphans: orphans.length,
          reaper,
        });
      },
    },
  },
});
