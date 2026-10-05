/**
 * MCP routing configuration.
 *
 * Every knob is read lazily inside a function so this module stays
 * import-safe: the MCP entry is evaluated at build time and at Worker cold
 * start, where request secrets do not exist yet.
 */

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

export function envValue(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Tool groups an operator can route on or off per environment. */
export const TOOL_GROUPS = ["catalog", "session", "lifecycle", "diagnostics"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface McpRouting {
  /** Groups currently routed to this deployment. */
  enabledGroups: ToolGroup[];
  /** When false, every mutating tool (start/stop/extend/reconnect) is refused. */
  allowMutations: boolean;
  /** Per-principal tool-call ceiling inside the rate window. */
  rateLimit: number;
  rateWindowSeconds: number;
}

/**
 * `MCP_TOOL_GROUPS` accepts `all` (default) or a comma separated subset, e.g.
 * `catalog,diagnostics` for a read-only agent deployment.
 */
export function routing(): McpRouting {
  const raw = envValue("MCP_TOOL_GROUPS") ?? "all";
  const enabledGroups =
    raw.toLowerCase() === "all"
      ? [...TOOL_GROUPS]
      : raw
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter((part): part is ToolGroup => (TOOL_GROUPS as readonly string[]).includes(part));
  const allowMutations = (envValue("MCP_ALLOW_MUTATIONS") ?? "true").toLowerCase() !== "false";
  const rateLimit = Number(envValue("MCP_RATE_LIMIT") ?? 60);
  const rateWindowSeconds = Number(envValue("MCP_RATE_WINDOW_SECONDS") ?? 60);
  return {
    enabledGroups: enabledGroups.length ? enabledGroups : [...TOOL_GROUPS],
    allowMutations,
    rateLimit: Number.isFinite(rateLimit) && rateLimit > 0 ? rateLimit : 60,
    rateWindowSeconds: Number.isFinite(rateWindowSeconds) && rateWindowSeconds > 0 ? rateWindowSeconds : 60,
  };
}

export function groupEnabled(group: ToolGroup): boolean {
  return routing().enabledGroups.includes(group);
}

/** The direct Supabase issuer. Never the publish-time proxy host. */
export function oauthIssuer(): string {
  const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";
  return `https://${projectRef}.supabase.co/auth/v1`;
}
