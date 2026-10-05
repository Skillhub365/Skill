# Runbook: secret rotation

Rotate on schedule (90 days) and immediately on suspicion of exposure.

## Platform secrets (Key Vault)

1. Create a new version of the secret in Key Vault (name uses dashes, e.g. `LAB-VM-PASSWORD`).
2. Wait for `KEY_VAULT_CACHE_TTL_MS` or restart the app to bust the cache.
3. Confirm `GET /api/infra/status` still reports `environmentValid: true`.

## Cloud connection credentials

1. Create a new service-principal secret in Azure.
2. Admin → Cloud → Connections → *connection* → rotate credential; the platform writes
   the new value to Key Vault and keeps only the `keyvault://` reference in the database.
3. Run **Test connection**; then remove the old Azure secret.

## Guacamole / RDP

1. Change the gateway service account password in Guacamole, update
   `GUACAMOLE-ADMIN-PASSWORD` in Key Vault.
2. Change the RDP account on the image, update `LAB-VM-PASSWORD`, rebuild/republish
   the image version and refresh pool VMs.
3. Launch a test lab and confirm the desktop connects.

## Session signing key

Rotating `SESSION-SIGNING-KEY` invalidates outstanding signed workspace links.
Announce it, rotate, restart, confirm learners can still open their workspace URL.

## Verify

Security audit shows no `KEY_VAULT_UNREACHABLE`; connection health is green; a full
launch → connect → stop cycle succeeds.

## Escalation

If a rotation breaks live sessions, restore the previous secret version in Key Vault
and restart the app; then investigate in staging.
