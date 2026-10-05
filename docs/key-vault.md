# Key Vault and secret rotation

## Create

One vault per environment, RBAC authorization enabled, soft-delete and purge
protection on. Set `AZURE_KEY_VAULT_URI=https://<vault>.vault.azure.net`.

## Access

Grant the app's managed identity `Key Vault Secrets User` (add `Secrets Officer`
only if the platform must write rotated cloud-connection secrets). A service
principal is a development/staging fallback; production requires
`AZURE_ALLOW_SERVICE_PRINCIPAL=true` to accept the risk, and startup validation
flags it as an error otherwise.

## Naming

Platform secret names map 1:1 with underscores rewritten as dashes:
`SESSION_SIGNING_KEY` → `SESSION-SIGNING-KEY`. Cloud-connection credentials use
`<connectionId>-secret` and are referenced as `keyvault://skilltrack/azure/<connectionId>-secret`.

## Required secrets

`SUPABASE-SERVICE-ROLE-KEY`, `SESSION-SIGNING-KEY`, plus, when the feature is on:
`GUACAMOLE-ADMIN-PASSWORD`, `GUACAMOLE-SHARED-SECRET`, `LAB-VM-USERNAME`,
`LAB-VM-PASSWORD`, `AZURE-CLIENT-SECRET`, `ENTRA-CLIENT-SECRET`, `DATABASE-URL`.

## Local development

No vault: values resolve from the environment, and the signing key is an ephemeral
per-process value. Never point local development at the production vault.

## Fail-fast

Staging and production throw at startup when the vault is unset or unreachable, and
record `KEY_VAULT_UNREACHABLE` / `ENV_VALIDATION_FAILED` security events. Reads
are cached for `KEY_VAULT_CACHE_TTL_MS`; a rotation is picked up after the TTL or
immediately via `refreshSecrets()`.

## Rotation and incidents

See [runbooks/secret-rotation.md](runbooks/secret-rotation.md) and
[runbooks/incident-response.md](runbooks/incident-response.md).
