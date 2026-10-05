import { createFileRoute } from "@tanstack/react-router";

const noStore = { "Cache-Control": "no-store" };

/**
 * Identity provider capabilities for the sign-in UI.
 *
 * Tokens are issued by the platform identity service (Cloud Auth / Microsoft
 * Entra ID), never by this app: there is no local credential grant here.
 */
export const Route = createFileRoute("/api/auth/token")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          {
            providers: {
              password: { enabled: true },
              entra: { enabled: true, label: "Microsoft Entra ID", authority: null },
            },
          },
          { headers: noStore },
        ),
      POST: async () =>
        Response.json(
          {
            error: "INVALID_REQUEST",
            code: "INVALID_REQUEST",
            detail: "Local token issuance has been removed. Sign in through the identity provider.",
          },
          { status: 410, headers: noStore },
        ),
    },
  },
});
