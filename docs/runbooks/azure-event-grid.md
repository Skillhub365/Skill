# Runbook: Azure Event Grid live integration

SkillTrack keeps VM state in sync with Azure two ways:

1. **Event-driven (primary)** — Azure Event Grid POSTs resource events to
   `/api/public/events/azure`; each event updates `vm_pool_entries` /
   `vm_records` and pushes a lifecycle event to any live session.
2. **Reconciliation (safety net)** — a scheduled job reads real Azure state for
   every registered machine, corrects drift, and flags orphans/missing VMs.

Manual "Sync" remains available but is no longer how production stays fresh.

## Setup

1. Generate a long random ingest key and store it as the `AZURE_EVENTGRID_KEY`
   secret (backend secrets, not client env).
2. Create an Event Grid **system topic** on each Azure subscription used by a
   cloud connection (topic type: `Microsoft.Resources.Subscriptions`).
3. Add an event subscription:
   - Endpoint type: Web Hook
   - Endpoint URL: `https://project--<project-id>.lovable.app/api/public/events/azure?key=<ingest key>`
   - Filter to event types: `Microsoft.Resources.ResourceWriteSuccess`,
     `ResourceWriteFailure`, `ResourceDeleteSuccess`, `ResourceActionSuccess`,
     `ResourceActionFailure`
   - Advanced filter: `subject` contains `/providers/Microsoft.Compute/virtualMachines/`
4. Azure performs a subscription **validation handshake**: it sends a
   `Microsoft.EventGrid.SubscriptionValidationEvent`; the endpoint echoes the
   `validationCode`. This only succeeds when the ingest key matches.

## What the endpoint enforces

- Ingest key required, compared in constant time; missing/incorrect key → 401.
- Payload must be a JSON array of Event Grid envelopes; oversized or malformed
  batches are rejected with 400 and counted as rejections.
- Events for resources SkillTrack does not own are counted and dropped — never
  guessed or auto-created.
- The response body carries counters only, never resource IDs.

## Event mapping

| Azure signal | SkillTrack kind | Effect |
| --- | --- | --- |
| `start/action` accepted | `start-accepted` | STARTING |
| `start/action` succeeded, write succeeded | `running` | RUNNING / READY-eligible |
| `deallocate` accepted | `deallocating` | STOPPING |
| `deallocate` succeeded | `deallocated` | STOPPED |
| any action failed | `failed` | ERROR + lifecycle error event |
| write failed | `provisioning-failed` | ERROR |
| delete succeeded | `deleted` | ERROR + marked missing in Azure |

Machines attached to an **active session** are never demoted by an event that
would break the session's lifecycle guard; the drift flag is raised instead.

## Reconciliation

Runs on a timer and on demand from **Cloud → Connections** or **Cloud → VM Pool**
("Reconcile with Azure"). It reports machines checked, corrected, orphaned
(exists in Azure, unknown to SkillTrack) and missing (known here, gone in Azure).
Findings surface as drift badges in the VM Pool table.

## Verifying

- **Handshake**: re-create the event subscription; Azure shows "Provisioned".
- **Mock event** (staging):

  ```bash
  curl -X POST "$BASE/api/public/events/azure?key=$AZURE_EVENTGRID_KEY" \
    -H 'content-type: application/json' \
    -d '[{"id":"1","eventType":"Microsoft.Resources.ResourceActionSuccess",
          "subject":"/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Compute/virtualMachines/<vm>",
          "data":{"operationName":"Microsoft.Compute/virtualMachines/start/action","status":"Succeeded"}}]'
  ```

  Expect `{"received":1,"applied":1,...}` and the VM Pool row flipping to
  running with source "Azure event" within a second (Supabase Realtime push).
- **Bad key** returns 401 and increments the rejected counter on the connection card.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Banner says "Event Grid not configured" | Ingest key secret missing | Set `AZURE_EVENTGRID_KEY`, recreate subscription |
| "Configured, awaiting events" for hours | Subscription filter too narrow or deleted | Check Event Grid delivery metrics / dead-letter |
| Drift badges after events | Session guard blocked the change, or manual Azure action | Run reconciliation; check session state |
| "Missing in Azure" | VM deleted outside SkillTrack | Retire the pool entry |