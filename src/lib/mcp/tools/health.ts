import { defineTool } from "@lovable.dev/mcp-js";
import { result, withTool } from "../context";
import { envValue, routing } from "../config";

/**
 * Deployment health for the MCP surface itself. Deliberately anonymous and
 * deliberately boring: it reports whether integrations are configured, never
 * their endpoints, credentials or tenant data.
 */
export default defineTool({
  name: "skilltrack_health",
  title: "MCP health",
  description:
    "Report whether the SkillTrack Labs MCP server is healthy: which tool groups are routed, whether mutations are permitted, and whether the cloud, gateway and database integrations are configured. Returns no tenant data.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withTool({ name: "skilltrack_health", group: "diagnostics", anonymous: true }, async () => {
    const config = routing();
    const checks: Record<string, "configured" | "not_configured"> = {
      database: envValue("SUPABASE_URL", "VITE_SUPABASE_URL") ? "configured" : "not_configured",
      azure: envValue("AZURE_TENANT_ID") ? "configured" : "not_configured",
      gateway: envValue("GUACAMOLE_URL", "GUACAMOLE_PUBLIC_URL") ? "configured" : "not_configured",
      keyVault: envValue("AZURE_KEY_VAULT_URI") ? "configured" : "not_configured",
    };
    return result({
      ok: true,
      status: checks["database"] === "configured" ? "healthy" : "degraded",
      mode: envValue("CLOUD_MODE") ?? "mock",
      enabledToolGroups: config.enabledGroups,
      mutationsAllowed: config.allowMutations,
      rateLimit: `${config.rateLimit} calls / ${config.rateWindowSeconds}s`,
      integrations: checks,
      checkedAt: new Date().toISOString(),
    });
  }),
});
