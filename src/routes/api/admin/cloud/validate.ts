import { createFileRoute } from "@tanstack/react-router";

/**
 * Test Connection for credentials that have not been saved yet (the
 * "Connect Azure Subscription" modal). Runs the real Azure validation chain
 * and returns per-step progress. The secret is used in-process and discarded.
 */
export const Route = createFileRoute("/api/admin/cloud/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeCloudAdmin: authorize, ok, deny } = await import("@/lib/security/guard.server");
        const guard = await authorize(request);
        if ("denied" in guard) return guard.denied;

        const body = (await request.json().catch(() => null)) as
          | { tenantId: string; subscriptionId: string; clientId: string; clientSecret: string; defaultResourceGroup?: string; connectionId?: string }
          | null;
        if (!body?.tenantId || !body.subscriptionId || !body.clientId) {
          return deny("INVALID_REQUEST", "Tenant ID, subscription ID and client ID are required.");
        }

        // Editing an existing connection without retyping the secret: reuse
        // the stored one. The browser never sees it either way.
        let clientSecret = body.clientSecret;
        if (!clientSecret && body.connectionId) {
          const { getConnection } = await import("@/lib/cloud/connections/registry.server");
          const { resolveSecret } = await import("@/lib/cloud/connections/secret-vault.server");
          const existing = getConnection(body.connectionId);
          clientSecret = existing ? ((await resolveSecret(existing.secretReference)) ?? "") : "";
        }
        if (!clientSecret) return deny("INVALID_REQUEST", "Client secret is required.");

        const { validateAzureCredentials } = await import("@/lib/cloud/connections/validate.server");
        const result = await validateAzureCredentials(
          {
            tenantId: body.tenantId.trim(),
            clientId: body.clientId.trim(),
            clientSecret,
            subscriptionId: body.subscriptionId.trim(),
          },
          { resourceGroup: body.defaultResourceGroup?.trim() || null },
        );
        return ok({ result });
      },
    },
  },
});
