import { createClient } from "@supabase/supabase-js";
import type { Principal } from "./types";
import type { Role } from "@/lib/mock-data";

/**
 * Trusted identity resolution.
 *
 * The browser only ever presents a Cloud Auth access token. Everything the
 * authorization chain relies on — role, tenant, workspace membership, lab
 * assignment — is read from authoritative database records here. Nothing the
 * caller sends is treated as a claim about who they are or what they may do.
 */

export interface ResolvedIdentity extends Principal {
  tenantId: string | null;
  status: string;
  /** Workspace ids where the account is an active member. */
  workspaceIds: string[];
  /** Lab ids currently assigned (and not revoked). */
  labIds: string[];
  capabilities: string[];
}

export type IdentityResult =
  | { ok: true; principal: ResolvedIdentity }
  | { ok: false; reason: "AUTH_INVALID" | "AUTH_EXPIRED" | "AUTH_REQUIRED" };

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; identity: ResolvedIdentity }>();

function authClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Cloud auth is not configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Verify the access token and hydrate the principal from database records. */
export async function resolveIdentity(token: string): Promise<IdentityResult> {
  const cached = cache.get(token);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ok: true, principal: cached.identity };
  }

  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) {
    const expired = (error?.message ?? "").toLowerCase().includes("expired");
    return { ok: false, reason: expired ? "AUTH_EXPIRED" : "AUTH_INVALID" };
  }
  const userId = data.user.id;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [profileRes, rolesRes, membershipRes, assignmentRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("id, email, full_name, status, tenant_id").eq("id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.from("workspace_users").select("workspace_id, capabilities, status").eq("user_id", userId),
    supabaseAdmin.from("lab_assignments").select("lab_id, status").eq("user_id", userId),
  ]);

  const profile = profileRes.data;
  if (!profile) return { ok: false, reason: "AUTH_INVALID" };
  // Disabled or suspended accounts cannot act, even with a valid token.
  if (profile.status !== "active" && profile.status !== "invited") {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  const roles = (rolesRes.data ?? []).map((r) => r.role as Role);
  const role: Role = roles.includes("superadmin") ? "superadmin" : roles.includes("admin") ? "admin" : "user";

  const memberships = (membershipRes.data ?? []).filter((m) => m.status === "active");
  const workspaceIds = memberships.map((m) => m.workspace_id);
  const capabilities = [...new Set(memberships.flatMap((m) => m.capabilities ?? []))];
  const labIds = (assignmentRes.data ?? []).filter((a) => a.status !== "revoked").map((a) => a.lab_id);

  let org = "";
  if (profile.tenant_id) {
    const { data: tenant } = await supabaseAdmin.from("tenants").select("name").eq("id", profile.tenant_id).maybeSingle();
    org = tenant?.name ?? "";
  }

  const now = Math.floor(Date.now() / 1000);
  const identity: ResolvedIdentity = {
    sub: userId,
    name: profile.full_name ?? profile.email,
    email: profile.email,
    role,
    org,
    tenantId: profile.tenant_id,
    status: profile.status,
    workspaces: workspaceIds,
    workspaceIds,
    labs: labIds,
    labIds,
    capabilities,
    idp: data.user.app_metadata?.provider === "azure" ? "entra" : "password",
    iat: now,
    exp: now + 900,
  };

  cache.set(token, { at: Date.now(), identity });
  if (cache.size > 500) {
    for (const [k, v] of cache) if (Date.now() - v.at > CACHE_TTL_MS) cache.delete(k);
  }
  return { ok: true, principal: identity };
}

/**
 * Drop cached identities after a role, membership, capability or status
 * change, so the next request re-reads the authoritative rows instead of
 * acting on stale permissions.
 *
 * Pass a user id to evict only that account; call with no argument (for
 * example after a tenant-wide change) to clear everything.
 */
export function invalidateIdentityCache(userId?: string) {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const [token, entry] of cache) {
    if (entry.identity.sub === userId) cache.delete(token);
  }
}
