# Observability

## Logs to watch

| Prefix / action | Meaning |
| --- | --- |
| `[env]` | Startup validation warnings and errors |
| `[secrets]` / `[secret-vault]` | Key Vault read/write failure (status only, never a value) |
| `Lab start failed for <labId>` | Launch failure with a normalized Azure code |
| `Launch rollback failed` | Compensation could not release a VM — investigate immediately |
| `ENV_VALIDATION_FAILED`, `KEY_VAULT_UNREACHABLE`, `PRODUCTION_FALLBACK_PREVENTED` | Security audit events |

Durable signals: `activity_logs`, `session_events`, `lifecycle_events`,
`cleanup_runs`, cloud audit log.

## Metrics and alerts

| Metric | Source | Suggested alert |
| --- | --- | --- |
| VM start failure rate | launch failures / launches | > 5% over 15 min |
| VM readiness timeout rate | `LAB_VM_READY_TIMEOUT_MS` exceeded | > 2% over 30 min |
| Active sessions | `sessions` where active | above pool size − headroom |
| Orphan VMs | orphan sweep results | any orphan older than 30 min |
| Failed cleanup attempts | `cleanup_runs` failures | 2 consecutive failures |
| Gateway connection failures | connection endpoint errors | > 3 in 10 min |
| Auth failures | security audit denials | spike vs. baseline |
| Key Vault failures | `KEY_VAULT_UNREACHABLE` | any occurrence in production |
| Azure quota/SKU errors | normalized Azure codes | any occurrence |
| Database errors | Supabase logs | any sustained error rate |
| Long-running / costly VMs | Admin → Cost | VM running > max session + grace |

## Health endpoints

- `GET /api/infra/status` — admin-only modes, flags, validation report, gateway probe.
- `GET /api/security/posture` — security posture summary.
- `GET /api/admin/cloud/health` — cloud connection diagnostics.

TODO: no metrics exporter is wired yet. Until one exists, alerts are built from
Log Analytics queries over the application logs plus scheduled queries against the
tables above.
