import { createFileRoute } from "@tanstack/react-router";

/**
 * The catalogue snapshot the console renders from. Everything is resolved from
 * database records and narrowed to what the caller may see, so the browser
 * never holds authoritative platform state.
 */
export const Route = createFileRoute("/api/catalog/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request);
        if ("denied" in guard) return guard.denied;

        const { loadCatalog, toCatalogPrincipal } = await import("@/lib/db/catalog.repo.server");
        const snapshot = await loadCatalog(toCatalogPrincipal(guard.context.principal));
        return ok(snapshot);
      },
    },
  },
});
