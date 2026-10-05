# Phase 4 — Secret management, Key Vault, startup validation, auth hardening

## Production authentication mode

One mode, no alternatives in production:

- Accounts live in the platform identity service (Supabase Auth).
- Email/password sign-in is enabled.
- **Microsoft sign-in** is brokered through the platform identity provider
  (`lovable.auth.signInWithOAuth("google" | "azure")` style flow) — the
  application never handles the OAuth code or the client secret.
- Direct Entra SSO (an application registration owned by the customer) is an
  opt-in extension, enabled with `ENABLE_ENTRA_SSO=true` plus
  `ENTRA_CLIENT_ID` / `ENTRA_TENANT_ID`.
- **No local token minting.** `/api/auth/token` does not issue application
  tokens; `POST` returns `410 Gone`. Sessions, refresh-token rotation and
  revocation belong entirely to the identity service.
- `/api/auth/me` is authoritative for role, tenant, workspace access, lab
  assignments and capabilities. Suspended or disabled accounts are rejected
  there even with a valid access token.
- Sign-out calls the identity service and clears local state; the root auth
  listener redirects.

### Local auth setup

1. Enable Lovable Cloud (already on) — the identity service is provisioned.
2. Create the first administrator through the admin Users screen, or invite by
   email. There are **no seeded demo credentials** anywhere in the product UI.
3. For local development only, create sample learners through the same admin
   screen. Do not commit credentials.

### Microsoft / Entra setup

- Brokered mode (default): enable the Microsoft provider in the backend auth
  settings. No secret lives in this repository.
- Direct SSO mode: register an application in Entra ID, add the redirect URI
  `https://<your-domain>/auth/callback`, then set `ENABLE_ENTRA_SSO=true`,
  `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and store `ENTRA_CLIENT_SECRET` in Key
  Vault.

## Azure Key Vault

`src/lib/security/azure-vault.server.ts` is the single vault client. Both
platform secrets (`secrets.server.ts`) and cloud-connection credentials
(`cloud/connections/secret-vault.server.ts`) go through it.

- Vault selected by `AZURE_KEY_VAULT_URI`; without it the platform reads the
  server environment (development only).
- Secret names map onto vault names with `_` rewritten to `-`.
- Values are cached in process memory for `KEY_VAULT_CACHE_TTL_MS`
  (default 5 minutes). Set it to `0` to disable caching.
- Rotation: write the new value in Key Vault, then either wait for the TTL or
  call `refreshSecrets("NAME")`. Rotating a cloud-connection credential through
  the admin UI busts the cache immediately and writes a
  `CLOUD_SECRET_ROTATED` audit event.
- Deleting a cloud connection **disables then deletes** its vault secret, so
  the credential stops working even under purge protection.
- Values are never logged, never returned by an API and never sent to a
  browser. The admin console sees presence and reachability only.

### Managed identity

Preferred everywhere. Two shapes are detected automatically:

- App Service / Container Apps: `IDENTITY_ENDPOINT` + `IDENTITY_HEADER`
  (injected by the platform). Set `AZURE_CLIENT_ID` to select a user-assigned
  identity.
- VM / VMSS: set `AZURE_USE_MANAGED_IDENTITY=true` to use IMDS.

Grant the identity the **Key Vault Secrets User** role (add **Secrets Officer**
when the platform must write or rotate secrets).

### Service principal fallback

`AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`. Allowed in
development and staging. In **production** it fails environment validation
unless `AZURE_ALLOW_SERVICE_PRINCIPAL=true` is set as an explicit, audited
exception.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `SKILLTRACK_ENV` | recommended | `development` \| `staging` \| `production` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role is server-only |
| `AZURE_KEY_VAULT_URI` | staging/production | Enables vault-backed secrets |
| `KEY_VAULT_CACHE_TTL_MS` | no | Secret cache TTL, default 300000 |
| `AZURE_USE_MANAGED_IDENTITY` | no | `true` for IMDS-hosted deployments |
| `AZURE_ALLOW_SERVICE_PRINCIPAL` | no | Permits a service principal in production |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | conditional | Service principal fallback |
| `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` | live | Real VM lifecycle |
| `AZURE_VNET_NAME`, `AZURE_SUBNET_NAME` | dynamic provisioning | Required when `ENABLE_DYNAMIC_VM_PROVISIONING=true` |
| `GUACAMOLE_URL`, `GUACAMOLE_USERNAME`, `GUACAMOLE_ADMIN_PASSWORD` | live | Remote desktop broker |
| `GUACAMOLE_PUBLIC_URL` | live | Browser-facing HTTPS origin |
| `LAB_VM_USERNAME`, `LAB_VM_PASSWORD`, `LAB_VM_DOMAIN` | live | RDP credentials injected server-side |
| `SESSION_SIGNING_KEY` | staging/production | No hard-coded fallback exists |
| `ENABLE_ENTRA_SSO`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | optional | Direct Entra SSO |
| `DISABLE_SESSION_REAPER` | no | Turns off expired-session reclamation |
| `DISABLE_REMOTE_DESKTOP` | no | Disables the gateway requirement |
| `ALLOW_MOCK_FALLBACK` | emergency only | Permits simulated infrastructure outside development |

## Startup validation

`src/lib/infra/env-validation.server.ts` runs on the first server request
(`ensureEnvironmentValidated`).

- **Development**: logs warnings, uses safe local fallbacks (mock Azure,
  simulated desktop, ephemeral per-process signing key).
- **Staging / production**: throws on any `error` check, so the deployment
  fails visibly instead of serving traffic with a missing credential, and
  writes an `ENV_VALIDATION_FAILED` audit event.
- Results are exposed, redacted, at `/api/security/posture` and
  `/api/infra/status`, and rendered on the admin Security page.

## No silent downgrade

`infraModes()` no longer falls back to mock infrastructure in a live
environment. An incomplete configuration is reported as `degraded`, and
`assertLiveInfrastructure()` throws (auditing
`PRODUCTION_FALLBACK_PREVENTED`) when the orchestrator or the remote-desktop
broker is asked to run without real Azure or a real gateway. To force a
downgrade during an incident, set `ALLOW_MOCK_FALLBACK=true`; the admin console
displays a warning for as long as it is active.

## Removed demo traces

- Landing page demo credentials (`admin@…/admin123`, `…/learn123`) removed.
- "Phase 1 MVP" badge removed.
- Hard-coded development signing key removed — development derives an
  ephemeral per-process key instead.
- No seeded credential display remains in any production screen.

## Audit events

Written through `src/lib/db/security-audit.server.ts` into `activity_logs`
(category `security`): `LOGIN_FAILED`, `PROFILE_RESOLVED`, `ACCESS_DENIED`,
`USER_INVITED`, `USER_SUSPENDED`, `USER_REACTIVATED`, `ROLE_CHANGED`,
`WORKSPACE_MEMBERSHIP_CHANGED`, `LAB_ASSIGNMENT_CHANGED`,
`CAPABILITIES_CHANGED`, `CLOUD_SECRET_ROTATED`, `ENV_VALIDATION_FAILED`,
`KEY_VAULT_UNREACHABLE`, `PRODUCTION_FALLBACK_PREVENTED`.

Tokens, passwords, secrets, private IPs, RDP credentials and OAuth codes are
never written: the helper strips forbidden metadata keys before the insert.

## Tenant and user hardening

- Every admin write re-scopes to the caller's tenant; an id from another tenant
  matches no row.
- Only a superadmin can grant the superadmin role; nobody can change their own
  role or disable their own account.
- Role, status, membership, capability and assignment changes invalidate the
  cached identity for that user, so the next request is authorized on fresh
  data.
- Learners cannot reach any of these routes — the guard requires an admin role
  plus the matching capability.

## Manual verification

1. `bun install`, then start the app — development boots with warnings only.
2. Unset `SESSION_SIGNING_KEY` with `SKILLTRACK_ENV=production` — the first
   request fails with an environment-validation error.
3. With `AZURE_KEY_VAULT_URI` and a managed identity, open admin → Security:
   Key Vault shows *reachable* and the secret list shows presence only.
4. `POST /api/auth/token` returns `410 Gone`.
5. Sign in with password and with Microsoft — both land on the correct console.
6. Suspend a user, then call `/api/auth/me` with their token — `401`.
7. Change a user's role and re-request a protected route — the new role applies
   immediately.
8. Confirm no demo credentials appear anywhere in the UI.

## Known Phase 5+ gaps

- Lab launch and reaper hardening (retry/backoff, partial-failure compensation).
- CI pipeline and infrastructure-as-code.
- Automated secret-rotation scheduling (rotation is manual/API-driven today).
- Per-tenant Key Vaults and customer-managed keys.
- Automated test suite (no test framework is configured yet).
