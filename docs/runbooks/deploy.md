# Runbook: deploy

## Pre-deployment

- [ ] CI green on the commit (`lint`, `typecheck`, `test`, `build`).
- [ ] Change ticket lists migrations, new env vars and rollback owner.
- [ ] Maintenance window agreed if migrations are destructive.
- [ ] Database snapshot taken; snapshot id recorded.

## Environment variables

- [ ] `SKILLTRACK_ENV` correct for the target.
- [ ] Supabase URL + publishable key set; service-role key resolvable from Key Vault.
- [ ] `AZURE_KEY_VAULT_URI` set and the app identity has `Key Vault Secrets User`.
- [ ] `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `AZURE_VNET_NAME`, `AZURE_SUBNET_NAME`.
- [ ] `GUACAMOLE_URL` internal, `GUACAMOLE_PUBLIC_URL` HTTPS, service account set.
- [ ] `LAB_VM_USERNAME` / `LAB_VM_PASSWORD` in Key Vault.
- [ ] `ALLOW_MOCK_FALLBACK=false`, `DISABLE_SESSION_REAPER=false`.

## Migrations

- [ ] Applied to staging first and smoke-tested.
- [ ] Applied to production; every new public table has GRANT + RLS + policies.

## Deploy

1. Build and release the app.
2. Watch startup logs for `[env]` errors — production refuses to serve on invalid config.
3. Confirm `GET /api/infra/status` shows `environmentValid: true` and `degraded: false`.

## Smoke tests

- [ ] Admin sign-in; Overview KPIs render.
- [ ] `GET /api/security/posture` clean.
- [ ] `GET /api/admin/cloud/health` — connections healthy.
- [ ] VM pool shows expected machines after Sync.
- [ ] Learner sign-in on a workspace URL; a published lab is listed.
- [ ] Launch a lab: VM reaches READY, desktop connects over WSS.
- [ ] Stop the lab: VM deallocates, gateway user/connection deleted.
- [ ] `npm run test:e2e` against the target host if it is reachable.

## Post-deployment validation

- [ ] No new security events in Admin → Security.
- [ ] Reaper recorded a run in `cleanup_runs` within the last 2 minutes.
- [ ] No orphaned VMs.
- [ ] Cost screen shows no unexpected running machines.

## Rollback

1. Redeploy the previous app build.
2. If a migration is implicated, follow [database-migration-rollback.md](database-migration-rollback.md).
3. Stop and release any VMs allocated during the bad window (Admin → Cloud → Orphans).
4. Record the incident and audit entries.
