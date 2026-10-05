import { createFileRoute } from "@tanstack/react-router";

/**
 * Agent-integration (MCP) status for the admin console: which tool groups are
 * routed, whether mutations are permitted, whether the integrations the tools
 * depend on are configured, and the most recent agent tool calls. Never
 * returns endpoints with credentials, tokens or secret values.
 */
export const Route = createFileRoute("/api/admin/mcp-status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { authorize, ok } = await import("@/lib/security/guard.server");
        const guard = await authorize(request, { role: "admin" });
        if ("denied" in guard) return guard.denied;

        const { routing, envValue, TOOL_GROUPS } = await import("@/lib/mcp/config");
        const config = routing();
        const origin = new URL(request.url).origin;

        const manifest = (await import("@/lib/mcp/manifest")).MCP_TOOLS;
        const integrations = {
          database: Boolean(envValue("SUPABASE_URL", "VITE_SUPABASE_URL")),
          azure: Boolean(envValue("AZURE_TENANT_ID")),
          gateway: Boolean(envValue("GUACAMOLE_URL", "GUACAMOLE_PUBLIC_URL")),
          keyVault: Boolean(envValue("AZURE_KEY_VAULT_URI")),
        };

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: calls } = await supabaseAdmin
          .from("activity_logs")
          .select("id, action, detail, actor_name, outcome, error_code, at")
          .in("action", ["MCP_TOOL_CALLED", "MCP_TOOL_DENIED"])
          .order("at", { ascending: false })
          .limit(25);

        const recent = (calls ?? []).map((row) => ({
          id: row.id,
          action: row.action,
          detail: row.detail,
          actor: row.actor_name,
          outcome: row.outcome,
          errorCode: row.error_code,
          at: row.at,
        }));

        return ok({
          generatedAt: new Date().toISOString(),
          endpoint: `${origin}/mcp`,
          metadataEndpoint: `${origin}/.well-known/oauth-protected-resource`,
          authMode: "OAuth 2.1 (SkillTrack Labs identity)",
          groups: TOOL_GROUPS.map((group) => ({ group, enabled: config.enabledGroups.includes(group) })),
          mutationsAllowed: config.allowMutations,
          rateLimit: { calls: config.rateLimit, windowSeconds: config.rateWindowSeconds },
          mode: envValue("CLOUD_MODE") ?? "mock",
          integrations,
          tools: manifest,
          recent,
          callsLast24h: recent.length,
        });
      },
    },
  },
});
