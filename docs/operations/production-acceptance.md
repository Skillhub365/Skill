# Production acceptance and release validation

Sign-off gate for a real customer pilot. Run this after
[the cutover checklist](./production-cutover.md) and before any learner
account is created.

Every step below is observable in the product — there is no step that requires
a database console.

## 1. End-to-end smoke journey

Perform in one sitting, on the target environment, with real Azure and real
Guacamole. Record the result column.

Copy `acceptance-runs/TEMPLATE.md` to `acceptance-runs/<YYYY-MM-DD>-<env>.md`
and fill it in as you go; that file is the durable record of the run. A run is
only valid when the pre-flight block shows no emergency fallback and no
simulated desktop — otherwise you validated mocks, not production.

| # | Actor | Step | Where | Pass criteria |
|---|-------|------|-------|---------------|
| 1 | Super Admin | Sign in | `/auth` | Entra ID sign-in succeeds; role badge reads Super Admin |
| 2 | Super Admin | Verify integrations | Operations, Readiness tab | Database, Realtime, Azure, Event Grid, Key Vault, Guacamole all green; no degraded banner |
| 3 | Super Admin | Verify live state | Operations, Live state tab | Reaper healthy, capacity green, no stuck sessions, no orphan machines |
| 4 | Super Admin | Register / sync VM pool | Cloud, VM Pool | Machines listed with real Azure names; no machine marked simulated |
| 5 | Super Admin | Start and test a machine | VM Pool row actions | Start succeeds; Test Azure green; Test RDP reports every step green |
| 6 | Admin | Create workspace | Workspaces | Workspace live at its org-prefixed URL |
| 7 | Admin | Create session-based lab | Workspace, Labs tab | Lab published with mode "Session-based" |
| 8 | Admin | Create persistent lab | Workspace, Labs tab | Lab published with mode "Persistent", policy and hours set |
| 9 | Admin | Assign learner to both labs | Lab access dialog | Learner sees both; persistent grant shows window and hours |
| 10 | Learner | Launch session-based lab | Learner home | Launch checklist completes to Ready |
| 11 | Learner | Connect through real RDP | Session view | Windows desktop renders; header shows real gateway, not simulation |
| 12 | Learner | Stop lab | Session view | Session ends; machine returns to the pool |
| 13 | Learner | Launch persistent lab | Learner home | Machine bound to the learner; remaining hours decrease while running |
| 14 | Learner | Stop, then resume the same lab | Learner home | Resume reattaches the *same* machine with prior state intact |
| 15 | Admin | Check usage report | Usage Reports | Both runs listed with learner, lab, workspace, VM, duration, cost, and remaining hours for the persistent run |
| 16 | Admin | Export | Usage Reports, Export | CSV downloads with the same columns |
| 17 | Operator | Reaper sweep | Operations, Live state | Expired/orphaned items reclaimed within one sweep window |
| 18 | Admin | Audit trail | Usage Reports, Activity tab | Every action above appears with actor, target and timestamp |

## 2. Automated coverage

`tests/integration/acceptance.test.ts` protects the reporting and operational
outcomes of the journey (both lab modes reported, persistent allowance
figures, resource-id redaction, stuck/orphan/capacity/reaper detection).
`tests/integration/session-api.test.ts` protects the HTTP security contract.
`tests/e2e/smoke.spec.ts` covers navigation and gating in a browser.

Run before every release:

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

## 3. Security review checklist

| Risk | Control | Verify |
|------|---------|--------|
| Secrets in browser payloads | Only `VITE_*` values reach the client; every provider secret is read inside a handler | Search the built client bundle for `SERVICE_ROLE`, `AZURE_CLIENT_SECRET`, `GUACAMOLE` — expect no hits |
| Service role in client bundle | `client.server.ts` is imported inside handlers only | `bun run build` succeeds without a server-only import warning |
| Private IP leakage | `poolVmForClient` redacts addresses; the connection route resolves the address server-side | Inspect a VM Pool and session API response — no `10.x` address |
| RDP credential leakage | Lab credentials live in Key Vault and are injected into the gateway connection, never returned | Session connection response contains no username/password |
| Azure token leakage | ARM tokens are minted per request in server code | No `Bearer` token in any API response |
| Guacamole admin token leakage | Learner receives a single-use, connection-scoped token for one connection only | Token in the tunnel URL cannot open another connection |
| Cross-tenant access | Every API forces the caller's tenant; two-tenant fixtures in tests | Tenant B admin cannot read Tenant A workspaces |
| Learner VM/session swapping | Authorization chain user → workspace → lab → session → VM → expiry | Editing a session id or VM id in a request returns 403 |
| Admin overreach | Cloud connections, cost and VM lifecycle require Super Admin | An ordinary admin gets 403 on those routes |

## 4. Reporting review

Usage Reports must show, per row: learner, lab, workspace, machine, start,
end, duration, status, estimated cost, assignment type, and — for persistent
grants — allowance and remaining hours, plus CSV/JSON export.

## 5. Operational review

Operations, Live state must show: active sessions, stuck sessions, failed
launches (24h), gateway failures (24h), orphan/drifted machines, pool
capacity, reaper health, and budget usage. Set `MONTHLY_BUDGET_USD` to enable
budget warnings; tune `OPS_STUCK_LAUNCH_MINUTES` and `OPS_LOW_CAPACITY_RATIO`
if the pilot's thresholds differ.

## 6. Rollback

Rollback is documented in [production-cutover.md](./production-cutover.md).
In short: stop new launches, let the reaper drain live sessions, redeploy the
previous release, and only then re-enable launches. `ALLOW_MOCK_FALLBACK` is
an emergency-only flag; while it is on, a degraded-mode banner is visible to
every admin and a security event is recorded on each readiness check.
