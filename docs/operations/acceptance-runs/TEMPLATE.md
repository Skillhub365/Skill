# Acceptance run record — <YYYY-MM-DD>

Fill one copy of this file per real run and commit it. Do not mark a step Pass
unless you personally observed the expected result against live infrastructure.

## Run metadata

| Field | Value |
| --- | --- |
| Date / time (UTC) | |
| Operator | |
| Environment | staging / production |
| Build / commit | |
| Azure subscription | <name only, never the id in plain docs> |
| Azure resource group | |
| Guacamole gateway | <public hostname> |
| Auth mode | managed-identity / service-principal |

Pre-flight (all must be true before step 1):

- [ ] `/api/admin/readiness` returns no `emergencyFallbackActive`
- [ ] `simulatedDesktopActive` is false
- [ ] Azure and Guacamole env/vault values resolve for this environment

## 1. Smoke journey results

| # | Persona | Step | Result | Evidence (screenshot / id / log) | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Super Admin | Sign in | | | |
| 2 | Super Admin | Verify integrations | | | |
| 3 | Super Admin | Verify live state | | | |
| 4 | Super Admin | Register / sync VM pool | | | |
| 5 | Super Admin | Start and test a machine | | | |
| 6 | Admin | Create workspace | | | |
| 7 | Admin | Create session-based lab | | | |
| 8 | Admin | Create persistent lab | | | |
| 9 | Admin | Assign learner to both labs | | | |
| 10 | Learner | Launch session-based lab | | | |
| 11 | Learner | Connect through real RDP | | | |
| 12 | Learner | Stop lab | | | |
| 13 | Learner | Launch persistent lab | | | |
| 14 | Learner | Stop, then resume same lab | | | |
| 15 | Admin | Check usage report | | | |
| 16 | Admin | Export | | | |
| 17 | Operator | Reaper sweep | | | |
| 18 | Admin | Audit trail | | | |

## 2. Identifiers captured

| Item | Value |
| --- | --- |
| Workspace slug | |
| Session-based lab id | |
| Persistent lab id | |
| Session ids | |
| Pool VM ids (never private IPs) | |

## 3. Defects raised

| # | Step | Severity | Description | Ticket |
| --- | --- | --- | --- | --- |

## 4. Sign-off

| Role | Name | Verdict | Date |
| --- | --- | --- | --- |
| Release owner | | go / no-go | |
| Security reviewer | | go / no-go | |

Evidence rules: no private IPs, no gateway tokens, no Azure credentials in
screenshots or notes. Redact before committing.
