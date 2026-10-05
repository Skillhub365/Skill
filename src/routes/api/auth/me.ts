import { createFileRoute } from "@tanstack/react-router";

const noStore = { "Cache-Control": "no-store" };

/**
 * Profile resolution happens on every page load, so the audit trail records
 * one event per account per window instead of one per request.
 */
const PROFILE_AUDIT_WINDOW_MS = 10 * 60_000;
const lastProfileAudit = new Map<string, number>();

/**
 * The authoritative view of the signed-in account. Role, organisation and
 * workspace access all come from database records — never from the browser.
 */
export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // First server request in this process validates the deployment
        // configuration; staging and production refuse to serve if it fails.
        const { ensureEnvironmentValidated } = await import("@/lib/infra/env-validation.server");
        await ensureEnvironmentValidated();

        const { bearerFrom, resolveIdentity } = await import("@/lib/security/identity.server");
        const token = bearerFrom(request);
        if (!token) {
          return Response.json({ error: "AUTH_REQUIRED", code: "AUTH_REQUIRED" }, { status: 401, headers: noStore });
        }
        const result = await resolveIdentity(token);
        if (!result.ok) {
          const { recordSecurityEvent } = await import("@/lib/db/security-audit.server");
          await recordSecurityEvent({
            action: "LOGIN_FAILED",
            outcome: "failure",
            errorCode: result.reason,
            detail: "An access token was rejected while resolving the profile.",
          });
          return Response.json({ error: result.reason, code: result.reason }, { status: 401, headers: noStore });
        }
        const p = result.principal;

        const last = lastProfileAudit.get(p.sub) ?? 0;
        if (Date.now() - last > PROFILE_AUDIT_WINDOW_MS) {
          lastProfileAudit.set(p.sub, Date.now());
          const { recordSecurityEvent } = await import("@/lib/db/security-audit.server");
          await recordSecurityEvent({
            action: "PROFILE_RESOLVED",
            tenantId: p.tenantId,
            actorId: p.sub,
            actorName: p.name,
            actorRole: p.role,
            targetType: "user",
            targetId: p.sub,
            detail: `Signed in as ${p.role} via ${p.idp === "entra" ? "Microsoft" : "password"}`,
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let workspaceSlug = "";
        let workspaceName = "";
        if (p.workspaceIds.length > 0) {
          const { data } = await supabaseAdmin
            .from("workspaces")
            .select("name, slug")
            .in("id", p.workspaceIds)
            .eq("status", "active")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          workspaceSlug = data?.slug ?? "";
          workspaceName = data?.name ?? "";
        }

        return Response.json(
          {
            user: {
              id: p.sub,
              name: p.name,
              email: p.email,
              role: p.role,
              org: p.org,
              workspaceSlug,
              workspaceName,
            },
            capabilities: p.capabilities,
            workspaceIds: p.workspaceIds,
            labIds: p.labIds,
          },
          { headers: noStore },
        );
      },
    },
  },
});
