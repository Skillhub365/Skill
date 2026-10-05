# Security model

## Authorization chain

`authorize()` (`src/lib/security/guard.server.ts`) resolves the principal from a
verified token and then re-derives every hop from durable records:
user → tenant → workspace → lab → session → VM. Denials return a stable code
(`FORBIDDEN_ROLE`, `INVALID_REQUEST`, `VM_UNAVAILABLE`, …) and never leak internals.

## Roles and capabilities

`superadmin` (platform: cloud connections, cost, Key Vault posture), `admin`
(tenant scope), `user` (assigned labs). Per-workspace capabilities add finer
control over cloud actions and VM start/stop.

## Data protection

RLS plus explicit GRANTs on every public table. Service-role usage is server-only,
inside handlers, after authorization. No privileged client is ever imported into a
browser bundle (`*.server.ts` import protection).

## Secrets

Key Vault in staging/production, environment locally. Names map with dashes
(`SESSION_SIGNING_KEY` → `SESSION-SIGNING-KEY`). Managed identity is preferred;
a service principal in production is an error unless
`AZURE_ALLOW_SERVICE_PRINCIPAL=true`. Cloud-connection credentials are stored
under `keyvault://skilltrack/azure/<connection>-secret` and only ever referenced.

## Network

Lab VMs have no public IP. RDP 3389 is allowed only from the gateway subnet. Only
443 is published on the gateway host. Guacd has no published ports.

## Auditing

`activity_logs` (platform actions), security events (`ENV_VALIDATION_FAILED`,
`KEY_VAULT_UNREACHABLE`, `PRODUCTION_FALLBACK_PREVENTED`, auth denials) and the
cloud audit log (connection and VM actions). Reviewed from Admin → Security and
Admin → Activity.

## Fail-fast

`ensureEnvironmentValidated()` runs once per process; staging and production throw
on a missing signing key, Supabase key, Azure or gateway configuration.
