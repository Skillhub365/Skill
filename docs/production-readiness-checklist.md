# Production readiness checklist

## Auth
- [ ] Production auth mode chosen and documented; Entra app registered if enabled.
- [ ] Redirect URLs allow-listed and same-origin.
- [ ] Super admin / admin / learner roles verified in `user_roles`.
- [ ] Suspension and session revocation tested end to end.

## Tenant isolation
- [ ] Cross-tenant workspace access returns 403.
- [ ] Unassigned or unpublished lab cannot be launched.
- [ ] Session, VM and gateway ids are unguessable and ownership-checked.

## Database / RLS
- [ ] Every public table has GRANTs, RLS enabled and policies.
- [ ] Service-role key used server-side only, after `authorize()`.
- [ ] Migrations applied in order; types regenerated.
- [ ] Point-in-time recovery enabled; snapshot before each release.

## Secrets / Key Vault
- [ ] `AZURE_KEY_VAULT_URI` set; managed identity has Secrets User.
- [ ] All required secrets present with the dashed naming convention.
- [ ] `AZURE_ALLOW_SERVICE_PRINCIPAL` false in production.
- [ ] Rotation schedule agreed and owner named.

## Azure networking
- [ ] Lab VMs have no public IP.
- [ ] NSG allows 3389 only from the gateway subnet.
- [ ] Gateway publishes only 443; guacd has no published ports.
- [ ] Quota confirmed for the pool size and SKU family.

## VM pool
- [ ] Pool sized to peak concurrency plus headroom.
- [ ] Registration and Sync verified.
- [ ] `VM_UNAVAILABLE` path surfaces a clear learner message.

## Guacamole
- [ ] TLS certificate valid and monitored for expiry.
- [ ] `guacadmin` disabled; service account scoped.
- [ ] Ephemeral users/connections removed on stop and expiry.

## Lifecycle / reaper
- [ ] `DISABLE_SESSION_REAPER=false`; recent `cleanup_runs` success.
- [ ] Expiry deallocates VMs and kills tunnels.
- [ ] Crash mid-launch leaves no orphan (compensation verified).

## Logging / monitoring
- [ ] Application logs shipped to Log Analytics.
- [ ] Alerts from [observability.md](observability.md) configured.
- [ ] Health endpoints monitored.

## Tests / CI
- [ ] `npm run ci` green on main.
- [ ] E2E smoke runs in CI.
- [ ] Tests never touch real infrastructure.

## Backup / restore
- [ ] Restore rehearsed against a non-production copy.
- [ ] Guacamole database backed up.
- [ ] Recovery time and point objectives agreed.

## Incident response
- [ ] On-call and escalation path defined.
- [ ] Runbooks reviewed within the last quarter.

## Compliance / security review
- [ ] Threat model reviewed for the authorization chain.
- [ ] Dependency scan clean.
- [ ] Data retention for sessions, events and audit logs agreed.
