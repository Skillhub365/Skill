# Authentication and tenancy

## Production auth mode

Supabase Auth is the identity provider of record. Microsoft Entra ID is available
as a social/SSO provider and is enabled with `ENABLE_ENTRA_SSO=true` plus
`ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET`. Tokens are always
verified server-side (`src/lib/security/identity.server.ts`); the browser session
is never trusted for an authorization decision.

## Entra setup

1. Register an application in Entra ID (single or multi-tenant to match your customers).
2. Add the redirect URL `https://<app-host>/auth/callback` (and the preview host for staging).
3. Create a client secret; store it in Key Vault as `ENTRA-CLIENT-SECRET`.
4. Configure the Microsoft provider in the platform's auth settings with the same client id/secret.
5. Set `ENABLE_ENTRA_SSO=true` and redeploy; startup validation fails if the ids are missing.

## Redirect URLs

Always same-origin and absolute: `${window.location.origin}/auth/callback`. Never
point OAuth directly at a protected route such as `/app` or a workspace URL —
store the intended path and navigate after the session hydrates.

## Local development auth

Leave `ENABLE_ENTRA_SSO=false` and sign in with email/password against the dev
project. Development derives an ephemeral signing key, so nothing signed locally
survives a restart.

## Tenant / profile / role bootstrap

- `public.handle_new_user` creates a `profiles` row on sign-up.
- Tenants live in `public.tenants`; a profile carries its tenant.
- Roles live in `public.user_roles` (`superadmin`, `admin`, `user`) and are checked
  with `public.has_role` / `public.is_admin`. Never store a role on a profile.
- Workspace membership lives in `public.workspace_users`; per-workspace RBAC
  capabilities are assigned from the workspace RBAC panel.

## Invitation / onboarding

Admin adds the user to a workspace (`workspace_users`), assigns labs
(`lab_assignments`), and shares the branded workspace URL. First sign-in creates
the profile; role and membership are already waiting. See
[runbooks/user-invitations.md](runbooks/user-invitations.md).

## Suspended users and revocation

Suspending a workspace user removes access at the next request — the guard reloads
membership per call, so no cached decision survives. Revoking a session (admin
Sessions screen) stops the VM, deletes the ephemeral gateway account and
terminates any live tunnel.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `Unsupported provider` | Microsoft provider not configured in auth settings |
| Redirect loop after sign-in | Redirect URL not same-origin / not allow-listed |
| 403 on a workspace URL | No `workspace_users` row, or wrong tenant |
| 403 on a lab | Lab not published, or no `lab_assignments` row |
| 401 on every server function | Bearer middleware missing in `src/start.ts` |
