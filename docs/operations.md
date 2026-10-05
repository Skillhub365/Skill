# Operations

## Daily

- Admin → Overview: active sessions, VM pool utilisation, failures.
- Admin → Security: environment validation, Key Vault posture, recent security events.
- Admin → Cloud → Orphans: nothing older than 30 minutes.
- Admin → Cost: no VM running beyond its session window.

## Routine tasks

| Task | Runbook |
| --- | --- |
| Onboard a tenant | [runbooks/tenant-onboarding.md](runbooks/tenant-onboarding.md) |
| Invite users | [runbooks/user-invitations.md](runbooks/user-invitations.md) |
| Rotate a secret | [runbooks/secret-rotation.md](runbooks/secret-rotation.md) |
| Failed VM start | [runbooks/failed-vm-start.md](runbooks/failed-vm-start.md) |
| Quota / SKU failure | [runbooks/quota-sku-failures.md](runbooks/quota-sku-failures.md) |
| Orphan cleanup | [runbooks/orphan-vm-cleanup.md](runbooks/orphan-vm-cleanup.md) |
| Gateway failure | [runbooks/gateway-failures.md](runbooks/gateway-failures.md) |
| Migration rollback | [runbooks/database-migration-rollback.md](runbooks/database-migration-rollback.md) |
| Incident | [runbooks/incident-response.md](runbooks/incident-response.md) |
| Deploy | [runbooks/deploy.md](runbooks/deploy.md) |

## Background workers

- **Reaper** — every 30s under a durable lease; expires sessions and reclaims orphans.
  Disabled by `DISABLE_SESSION_REAPER` (never in production).
- **Cloud refresh scheduler** — per-connection interval, default `CLOUD_REFRESH_INTERVAL_MS`,
  pausable per connection from the connection screen.

## Health

`GET /api/infra/status`, `GET /api/security/posture`, `GET /api/admin/cloud/health`
(all admin-authenticated). See [observability.md](observability.md).
