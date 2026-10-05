# Runbook: orphan VM cleanup

An **orphan** is a machine marked allocated with no live session, or a running VM
whose session already expired.

## Symptoms

Admin → Cloud → Orphans lists entries; pool utilisation stays high with few sessions;
cost screen shows machines running out of hours.

## Likely causes

- App crash between allocation and session creation (compensation did not complete).
- Reaper disabled (`DISABLE_SESSION_REAPER`) or its lease held by a dead instance.
- Azure stop call failed and was not retried.

## Investigate

1. `cleanup_runs`: last successful run and any failures.
2. `GET /api/infra/status`: `reaperConfigured`.
3. `vm_pool_entries` vs `sessions` for the listed VMs.
4. Azure portal/CLI: is the machine actually running?

## Remediate

1. Run the manual sweep from Admin → Cloud → Orphans.
2. Run **Sync** to reconcile pool state with Azure.
3. If a machine is still running in Azure but released in the pool, stop/deallocate it
   in Azure and re-Sync.
4. Re-enable the reaper if it was disabled; restart the app if the lease is stale.

## Verify

Orphan list empty, `cleanup_runs` shows a recent success, cost screen back to baseline,
audit entries recorded for each release.

## Escalation

Repeated orphans after a clean deploy indicate a compensation bug — file it with the
session ids and the `Launch rollback failed` log lines.
