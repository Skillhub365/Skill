# Runbook — Realtime subscriptions

## What is realtime

Admin and learner screens subscribe to Postgres change streams with the browser
Supabase client (publishable key + the signed-in user's session). RLS decides
which rows a browser receives; the service-role key is never used in the browser.

Tables in the `supabase_realtime` publication (all `REPLICA IDENTITY FULL`):

`sessions`, `session_events`, `lifecycle_events`, `vm_records`,
`vm_pool_entries`, `gateway_connections`, `activity_logs`, `cloud_connections`,
`cloud_inventory`.

## Client layer

- `src/lib/realtime/useRealtimeTable.ts` — one table, one channel, exposes
  `connecting | live | reconnecting | fallback`.
- `src/lib/realtime/hooks.ts` — `useRealtimeSessions`, `useRealtimeVmRecords`,
  `useRealtimeLifecycleEvents`, `useRealtimeActivityLogs`,
  `useRealtimeGatewayConnections`, `useRealtimeCloudConnections`,
  `useRealtimeCloudInventory`, `useRealtimeVmPoolEntries`, plus `useLiveRefresh`
  (multi-table channel → debounced reload of the page's authorised API).
- `RealtimeStatusBadge` renders the status plus the last update time.

Change events never carry the page's data: they only trigger a re-read of the
existing authorised API, so server-side redaction and tenant scoping still apply.

## Fallback

While a channel is not `live`, `useLiveRefresh` polls at the page's
`fallbackMs` (15–60s). While live, it keeps a slow heartbeat poll
(2–5 min, disabled on Usage Reports) to catch missed frames.

## Manual verification

1. `update public.sessions set status='EXPIRED' where id='<id>'` → `/admin/sessions` row changes without refresh.
2. `update public.vm_pool_entries set power_state='deallocated' where id='<id>'` → `/admin/cloud/vm-pool` updates.
3. `insert into public.lifecycle_events (...)` → `/admin/operations` and `/admin/usage` refresh.
4. Block `wss://*.supabase.co` in devtools → badge flips to "Fallback polling" and data still updates on the interval.
5. Sign in as a learner from another tenant → no rows from the first tenant arrive (RLS on the replication stream).

## Limitations

- `cloud_connections` rows stream to super admins only; they contain a Key Vault
  *reference* (`secret_ref`), never a secret value.
- Detailed launch progress still uses the server-mediated SSE stream; those
  events are also persisted to `lifecycle_events`, so admin screens see them.
