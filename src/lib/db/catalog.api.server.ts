import { authorize, deny } from "@/lib/security/guard.server";
import { tenantIdFor, toCatalogPrincipal, type CatalogPrincipal } from "./catalog.repo.server";
import type { WriteResult } from "./catalog.write.server";

/**
 * Shared entry gate for catalogue mutations: authenticate, require an admin
 * role, and resolve the tenant server-side. Routes never read a tenant, role
 * or workspace claim from the request body.
 */
export async function adminContext(
  request: Request,
  role: "admin" | "superadmin" = "admin",
): Promise<{ denied: Response } | { principal: CatalogPrincipal; tenantId: string }> {
  const guard = await authorize(request, { role });
  if ("denied" in guard) return guard;
  const principal = toCatalogPrincipal(guard.context.principal);
  const tenantId = await tenantIdFor(principal);
  if (!tenantId) return { denied: deny("FORBIDDEN_ORG", "No tenant is associated with this account") };
  return { principal, tenantId };
}

const noStore = { "Cache-Control": "no-store" };

/** Turn a repository result into an HTTP response with stable error codes. */
export function respond<T>(result: WriteResult<T>): Response {
  if (result.ok) return Response.json({ ok: true, ...result.data }, { headers: noStore });
  const status = result.reason === "NOT_FOUND" ? 404 : result.reason === "INVALID" ? 400 : 409;
  return Response.json({ error: result.reason, code: result.reason, detail: result.detail }, { status, headers: noStore });
}

/** Parse a JSON body, returning a 400 response instead of throwing. */
export async function parseBody<T>(request: Request, schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { denied: Response.json({ error: "INVALID_BODY", code: "INVALID_BODY" }, { status: 400, headers: noStore }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    return { denied: Response.json({ error: "INVALID_BODY", code: "INVALID_BODY" }, { status: 400, headers: noStore }) };
  }
  return { data: parsed.data };
}
