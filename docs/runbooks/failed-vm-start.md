# Runbook: failed VM start

## Symptoms

Learner sees the launch progress stall or fail; API returns a normalized error;
logs show `Lab start failed for <labId>`.

## Likely causes

- No idle machine in the pool (`VM_UNAVAILABLE`).
- Azure authorization failure (role assignment or expired service-principal secret).
- Quota / SKU / region rejection.
- Readiness timeout — VM started but never reported READY within `LAB_VM_READY_TIMEOUT_MS`.
- Pool row out of sync with Azure (`ResourceNotFound`).

## Investigate

1. Admin → Sessions: state of the failed session.
2. Admin → Cloud → VM Pool: idle vs allocated counts; run **Sync**.
3. Admin → Cloud → Connections → health / Test connection.
4. `GET /api/infra/status`: azure configured, auth mode, degraded reasons.
5. Application logs for the normalized Azure code; `lifecycle_events` for the session.

## Remediate

- Pool exhausted → register more VMs, or ask the learner to retry after a session ends.
- Auth failure → fix the role assignment or rotate the credential.
- Quota/SKU → [quota-sku-failures.md](quota-sku-failures.md).
- Readiness timeout → check the image (boot diagnostics, agent, RDP service); recycle the VM.
- Stale pool row → Sync, then release the machine if it is still marked allocated.

## Verify

Compensation released the VM (no orphan), the session is `FAILED` not `ACTIVE`, and a
retry launch succeeds. Check `activity_logs` and the cloud audit log.

## Escalation

Repeated failures across connections → platform owner; suspected Azure platform issue
→ open a support case with the correlation id from the Azure error.
