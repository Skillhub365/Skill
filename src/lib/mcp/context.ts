/**
 * Shared plumbing for every MCP tool: identity resolution, tenant-aware
 * authorization, routing gates, rate limiting, audit logging and metrics.
 *
 * Import-safe by construction — all server-only modules are pulled in with
 * dynamic `import()` inside the call, never at module scope.
 */

import type { ToolContext, ToolHandlerResult } from "@lovable.dev/mcp-js";
import type { Principal } from "@/lib/security/types";
import { groupEnabled, routing, type ToolGroup } from "./config";

/**
 * The caller, hydrated from database records under the verified token. Tool
 * input never contributes to it, so an agent cannot assert a tenant, a
 * workspace, a role or an identity it does not have.
 */
export interface McpPrincipal {
  sub: string;
  name: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  tenantId: string | null;
  workspaceIds: string[];
  labIds: string[];
  capabilities: string[];
  clientId: string | null;
  /** Full identity, passed to shared server flows that expect a Principal. */
  identity: Principal & { tenantId?: string | null };
}

export type McpDenialCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "TOOL_DISABLED"
  | "MUTATIONS_DISABLED"
  | "RATE_LIMITED"
  | "FORBIDDEN_TENANT"
  | "FORBIDDEN_WORKSPACE"
  | "FORBIDDEN_LAB"
  | "FORBIDDEN_SESSION"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR";

export class McpDenied extends Error {
  constructor(
    readonly code: McpDenialCode,
    message: string,
  ) {
    super(message);
    this.name = "McpDenied";
  }
}

export function fail(code: McpDenialCode, message: string): never {
  throw new McpDenied(code, message);
}

/** Structured, agent-readable result. */
export function result(payload: Record<string, unknown>): ToolHandlerResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(code: McpDenialCode, message: string): ToolHandlerResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, code, message }, null, 2) }],
    structuredContent: { ok: false, code, message },
    isError: true,
  };
}

/** Per-principal sliding window, per worker. Cheap protection against loops. */
const WINDOW_KEY = "__skilltrack_mcp_rate__";

function rateBucket(): Map<string, number[]> {
  const g = globalThis as unknown as Record<string, Map<string, number[]> | undefined>;
  if (!g[WINDOW_KEY]) g[WINDOW_KEY] = new Map();
  return g[WINDOW_KEY]!;
}

function checkRate(key: string) {
  const { rateLimit, rateWindowSeconds } = routing();
  const now = Date.now();
  const bucket = rateBucket();
  const hits = (bucket.get(key) ?? []).filter((at) => now - at < rateWindowSeconds * 1000);
  if (hits.length >= rateLimit) {
    fail("RATE_LIMITED", `Too many tool calls. The limit is ${rateLimit} per ${rateWindowSeconds}s.`);
  }
  hits.push(now);
  bucket.set(key, hits);
}

/**
 * Resolve the caller from the verified bearer token against authoritative
 * database records. Nothing the agent sends is treated as a claim about who it
 * is, which tenant it belongs to, or what it may reach.
 */
export async function principalFor(ctx: ToolContext): Promise<McpPrincipal> {
  const token = ctx.getToken();
  if (!ctx.isAuthenticated() || !token) fail("AUTH_REQUIRED", "Sign in to SkillTrack Labs to use these tools.");
  const { resolveIdentity } = await import("@/lib/security/identity.server");
  const resolved = await resolveIdentity(token);
  if (!resolved.ok) {
    fail(
      resolved.reason === "AUTH_EXPIRED" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      resolved.reason === "AUTH_EXPIRED" ? "The session has expired. Reconnect the integration." : "This identity is not valid for SkillTrack Labs.",
    );
  }
  const identity = resolved.principal;
  return {
    sub: identity.sub,
    name: identity.name,
    email: identity.email,
    role: identity.role as McpPrincipal["role"],
    tenantId: identity.tenantId,
    workspaceIds: identity.workspaceIds,
    labIds: identity.labIds,
    capabilities: identity.capabilities,
    clientId: ctx.getClientId() ?? null,
    identity,
  };
}

const isAdmin = (principal: McpPrincipal) => principal.role === "admin" || principal.role === "superadmin";

/** Tenant gate. A superadmin spans tenants; nobody else ever leaves their own. */
export function assertTenant(principal: McpPrincipal, tenantId: string | null | undefined) {
  if (principal.role === "superadmin") return;
  if (!tenantId || !principal.tenantId || tenantId !== principal.tenantId) {
    fail("FORBIDDEN_TENANT", "That resource belongs to another organisation.");
  }
}

export function assertWorkspace(principal: McpPrincipal, workspaceId: string) {
  if (isAdmin(principal)) return;
  if (!principal.workspaceIds.includes(workspaceId)) {
    fail("FORBIDDEN_WORKSPACE", "You are not a member of that workspace.");
  }
}

export function assertLab(principal: McpPrincipal, labId: string) {
  if (isAdmin(principal)) return;
  if (!principal.labIds.includes(labId)) fail("FORBIDDEN_LAB", "That lab is not assigned to you.");
}

/**
 * Load a session and prove the caller may act on it: same tenant, and either
 * the owner or an administrator of that tenant.
 */
export async function ownedSession(principal: McpPrincipal, sessionId: string) {
  const { getSession } = await import("@/lib/session/registry.server");
  const snapshot = await getSession(sessionId);
  if (!snapshot) fail("NOT_FOUND", "No session with that id.");
  const session = snapshot.session;
  // The session's tenant comes from its workspace row, never from the caller.
  assertTenant(principal, await tenantOfWorkspace(session.workspaceId));
  if (!isAdmin(principal) && session.userId !== principal.sub) {
    fail("FORBIDDEN_SESSION", "That session belongs to another learner.");
  }
  assertWorkspace(principal, session.workspaceId);
  return snapshot;
}

/** Authoritative tenant of a workspace, read from the database. */
export async function tenantOfWorkspace(workspaceId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("workspaces").select("tenant_id").eq("id", workspaceId).maybeSingle();
  return data?.tenant_id ?? null;
}

export interface ToolMeta {
  name: string;
  group: ToolGroup;
  /** Mutating tools are refused when MCP_ALLOW_MUTATIONS is false. */
  mutates?: boolean;
  /** Skip identity resolution (diagnostics only, never data access). */
  anonymous?: boolean;
}

/**
 * Wrap a tool body with routing, authorization, audit and metrics. Every call
 * writes exactly one audit row and one metric, success or failure, and neither
 * ever carries a token, secret or private connection detail.
 */
export function withTool<TInput>(
  meta: ToolMeta,
  body: (input: TInput, principal: McpPrincipal, ctx: ToolContext) => Promise<ToolHandlerResult>,
) {
  return async (input: TInput, ctx: ToolContext): Promise<ToolHandlerResult> => {
    const startedAt = Date.now();
    let principal: McpPrincipal | null = null;
    try {
      if (!groupEnabled(meta.group)) {
        fail("TOOL_DISABLED", `The ${meta.group} tools are not routed to this environment.`);
      }
      if (meta.mutates && !routing().allowMutations) {
        fail("MUTATIONS_DISABLED", "This deployment is configured read-only for agents.");
      }
      if (!meta.anonymous) {
        principal = await principalFor(ctx);
        checkRate(principal.sub);
      }
      const out = await body(input, principal ?? anonymousPrincipal(ctx), ctx);
      void audit(meta, principal, ctx, "success", null, Date.now() - startedAt);
      return out;
    } catch (error) {
      const denial =
        error instanceof McpDenied
          ? error
          : new McpDenied("UPSTREAM_ERROR", "The platform could not complete that request.");
      void audit(meta, principal, ctx, "failure", denial.code, Date.now() - startedAt, denial.message);
      if (!(error instanceof McpDenied)) {
        // Detail stays server-side; the agent gets a generic failure.
        console.error(`[mcp] ${meta.name} failed`, error);
      }
      return errorResult(denial.code, denial.message);
    }
  };
}

function anonymousPrincipal(ctx: ToolContext): McpPrincipal {
  return {
    sub: ctx.getUserId() ?? "anonymous",
    name: "Agent",
    email: ctx.getUserEmail() ?? "",
    role: "user",
    tenantId: null,
    workspaceIds: [],
    labIds: [],
    capabilities: [],
    clientId: ctx.getClientId() ?? null,
    identity: {
      sub: "anonymous",
      name: "Agent",
      email: "",
      role: "user",
      org: "",
      tenantId: null,
      workspaces: [],
      labs: [],
      idp: "password",
      iat: 0,
      exp: 0,
    },
  };
}

async function audit(
  meta: ToolMeta,
  principal: McpPrincipal | null,
  ctx: ToolContext,
  outcome: "success" | "failure",
  errorCode: string | null,
  durationMs: number,
  detail?: string,
) {
  const clientId = ctx.getClientId() ?? "unknown-client";
  try {
    const { recordMetric, recordDuration, METRIC } = await import("@/lib/observability/metrics.server");
    recordMetric(outcome === "success" ? METRIC.mcpToolSucceeded : METRIC.mcpToolFailed, 1, {
      userId: principal?.sub ?? null,
      tenantId: principal?.tenantId ?? null,
      outcome,
      metadata: { tool: meta.name, group: meta.group, clientId, ...(errorCode ? { errorCode } : {}) },
    });
    recordDuration(METRIC.mcpToolDurationMs, durationMs, {
      userId: principal?.sub ?? null,
      tenantId: principal?.tenantId ?? null,
      outcome,
      metadata: { tool: meta.name },
    });
  } catch {
    /* metrics never break a tool call */
  }
  try {
    const { recordActivity } = await import("@/lib/db/events.repo.server");
    await recordActivity({
      tenantId: principal?.tenantId ?? null,
      action: outcome === "success" ? "MCP_TOOL_CALLED" : "MCP_TOOL_DENIED",
      actorId: principal?.sub ?? null,
      actorName: principal?.name ?? "Agent",
      actorRole: principal?.role ?? null,
      targetType: "mcp_tool",
      targetId: meta.name,
      target: meta.name,
      outcome,
      errorCode,
      detail:
        outcome === "success"
          ? `Agent client ${clientId} called ${meta.name}.`
          : `Agent client ${clientId} was refused ${meta.name}: ${detail ?? errorCode ?? "denied"}.`,
      metadata: { tool: meta.name, group: meta.group, clientId, durationMs },
    });
  } catch {
    /* audit failures never break a tool call */
  }
}
