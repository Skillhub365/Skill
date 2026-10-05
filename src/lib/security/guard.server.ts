import { bearerFrom, resolveIdentity } from "./identity.server";
import { can, securityErrorStatus, type Capability, type Principal, type SecurityErrorCode } from "./types";
import type { Role } from "@/lib/mock-data";

/**
 * Central authorization guard. Every API request runs through this chain:
 * user -> organisation -> workspace -> lab -> session -> VM. Failures are
 * returned as stable error codes; the UI turns them into friendly copy.
 */

const noStore = { "Cache-Control": "no-store" };

/**
 * Denials are audited so a repeated FORBIDDEN_ORG or FORBIDDEN_LAB is visible
 * in the security feed. The audit write is fire-and-forget and never carries a
 * token or a request body.
 */
function auditDenial(code: SecurityErrorCode, principal?: Principal, detail?: string) {
  // Authentication failures are counted even when they are not audited, so a
  // credential-stuffing burst still shows up on the operations dashboard.
  void import("@/lib/observability/metrics.server")
    .then(({ recordMetric, METRIC }) =>
      recordMetric(code.startsWith("AUTH_") ? METRIC.authFailure : METRIC.authorizationDenied, 1, {
        userId: principal?.sub ?? null,
        outcome: "failure",
        metadata: { errorCode: code },
      }),
    )
    .catch(() => null);
  if (code === "AUTH_REQUIRED") return; // unauthenticated probes would flood the feed
  void import("@/lib/db/security-audit.server")
    .then(({ recordSecurityEvent }) =>
      recordSecurityEvent({
        action: "ACCESS_DENIED",
        outcome: "failure",
        tenantId: (principal as { tenantId?: string | null } | undefined)?.tenantId ?? null,
        actorId: principal?.sub ?? null,
        actorName: principal?.name ?? null,
        actorRole: principal?.role ?? null,
        errorCode: code,
        ...(detail ? { detail } : {}),
      }),
    )
    .catch(() => null);
}

export function deny(code: SecurityErrorCode, detail?: string, principal?: Principal) {
  auditDenial(code, principal, detail);
  return Response.json({ error: code, code, detail }, { status: securityErrorStatus[code], headers: noStore });
}

export function ok(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

export async function principalFrom(request: Request): Promise<{ principal: Principal } | { denied: Response }> {
  const token = bearerFrom(request);
  if (!token) return { denied: deny("AUTH_REQUIRED") };
  const result = await resolveIdentity(token);
  if (!result.ok) return { denied: deny(result.reason) };
  return { principal: result.principal };
}

function isAdmin(principal: Principal) {
  return principal.role === "admin" || principal.role === "superadmin";
}

function isSuperAdmin(principal: Principal) {
  return principal.role === "superadmin";
}

const rank: Record<Role, number> = { user: 0, admin: 1, superadmin: 2 };

export interface AuthorizeOptions {
  role?: Role;
  /** Capability the principal's role must hold (e.g. "cloud:manage"). */
  capability?: Capability | string | undefined;
  workspaceId?: string | undefined;
  labId?: string | undefined;
  sessionId?: string | undefined;
  vmId?: string | undefined;
  /**
   * Deprecated and ignored. Membership and assignment are resolved from
   * database records only; the browser cannot assert them.
   */
  clientAssertions?: { isWorkspaceMember?: boolean; isAssignedToLab?: boolean } | undefined;
}

export interface AuthorizedContext {
  principal: Principal;
}

/**
 * Resolve and authorize a request in one call. Returns either a context or a
 * ready-to-return denial response.
 */
export async function authorize(
  request: Request,
  options: AuthorizeOptions = {},
): Promise<{ context: AuthorizedContext } | { denied: Response }> {
  const auth = await principalFrom(request);
  if ("denied" in auth) return auth;
  const { principal } = auth;

  // Super Admin outranks Admin; Admin never satisfies a superadmin requirement.
  if (options.role && rank[principal.role] < rank[options.role]) {
    return { denied: deny("FORBIDDEN_ROLE", undefined, principal) };
  }

  // Capability check. Being an admin is not enough on its own: the capability
  // must be granted by the role matrix, so privileges stay explicit.
  if (options.capability && !can(principal.role, options.capability)) {
    return { denied: deny("FORBIDDEN_ROLE", undefined, principal) };
  }

  // Workspace: must exist, be usable, and include the principal.
  if (options.workspaceId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: workspace } = await supabaseAdmin
      .from("workspaces")
      .select("id, status, tenant_id")
      .eq("id", options.workspaceId)
      .maybeSingle();
    if (!workspace) return { denied: deny("WORKSPACE_UNAVAILABLE") };

    // Cross-tenant isolation: never satisfied by role alone.
    const tenantId = (principal as { tenantId?: string | null }).tenantId ?? null;
    if (workspace.tenant_id !== tenantId) return { denied: deny("FORBIDDEN_ORG", undefined, principal) };

    if (workspace.status !== "active" && !isAdmin(principal)) {
      return { denied: deny("WORKSPACE_UNAVAILABLE") };
    }
    const member = isAdmin(principal) || principal.workspaces.includes(options.workspaceId);
    if (!member) return { denied: deny("FORBIDDEN_WORKSPACE", undefined, principal) };
  }

  // Lab: must be published and assigned to the principal.
  if (options.labId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: lab } = await supabaseAdmin
      .from("labs")
      .select("id, status, workspace_id, workspaces!inner(tenant_id)")
      .eq("id", options.labId)
      .maybeSingle();
    if (!lab) return { denied: deny("LAB_UNAVAILABLE") };

    const labTenant = (lab as unknown as { workspaces: { tenant_id: string } }).workspaces?.tenant_id ?? null;
    const tenantId = (principal as { tenantId?: string | null }).tenantId ?? null;
    if (labTenant !== tenantId) return { denied: deny("FORBIDDEN_ORG", undefined, principal) };

    if (lab.status !== "published" && !isAdmin(principal)) {
      return { denied: deny("LAB_UNAVAILABLE") };
    }
    const assigned = isAdmin(principal) || principal.labs.includes(options.labId);
    if (!assigned) return { denied: deny("FORBIDDEN_LAB", undefined, principal) };
  }

  // Session + VM: ownership is checked against the server-side registry, never
  // against anything the caller supplied. A session URL is an entry point only.
  if (options.sessionId || options.vmId) {
    const { getSessionRaw } = await import("@/lib/session/registry.server");
    if (options.sessionId) {
      const session = await getSessionRaw(options.sessionId);
      if (session) {
        if (session.userId !== principal.sub && !isAdmin(principal)) {
          return { denied: deny("FORBIDDEN_SESSION") };
        }
        if (options.vmId && session.vmId !== options.vmId && !isAdmin(principal)) {
          return { denied: deny("FORBIDDEN_VM") };
        }
      }
    } else if (options.vmId && !isAdmin(principal)) {
      const { findVmOwner } = await import("@/lib/session/registry.server");
      const owner = await findVmOwner(options.vmId);
      if (owner && owner !== principal.sub) return { denied: deny("FORBIDDEN_VM") };
    }
  }

  return { context: { principal } };
}
/**
 * Cloud administration gate. Managing cloud connections and starting or
 * stopping virtual machines requires an admin role that also holds the
 * capability — anything else is denied and can be audited by the caller.
 */
export async function authorizeCloudAdmin(
  request: Request,
  capability: Capability | string = "cloud:manage",
): Promise<{ context: AuthorizedContext } | { denied: Response }> {
  // Cloud connections and cost management belong to the Super Admin persona.
  return authorize(request, { role: "superadmin", capability });
}

export { isSuperAdmin };
