# Runbook: incident response

## Severity

| Sev | Example |
| --- | --- |
| 1 | Credential leak, cross-tenant data exposure, lab VM reachable from the internet |
| 2 | No learner can launch or connect; database unavailable |
| 3 | Degraded: orphans accumulating, one connection unhealthy, elevated failures |

## First 15 minutes

1. Declare and record the start time, and assign an incident lead.
2. Contain: for a suspected leak, rotate the credential first
   ([secret-rotation.md](secret-rotation.md)); for exposure, disable the affected
   workspace/connection.
3. Snapshot evidence: logs, `activity_logs`, security events, cloud audit log entries.
4. Communicate to affected tenant admins.

## Leaked or exposed secret

1. Rotate in Key Vault; restart the app to bust the cache.
2. Invalidate downstream: Azure SP secret, Guacamole service account, RDP password,
   Supabase service-role key.
3. Terminate live sessions from Admin → Sessions and sweep orphans.
4. Review the audit log for use of the credential during the exposure window.
5. Purge the value from any place it was pasted (tickets, chat, CI logs).

## Suspected unauthorized access

1. Check security audit denials and successful admin actions by unexpected principals.
2. Suspend the account (`workspace_users`, roles) and revoke its sessions.
3. Verify RLS and the authorization chain for the accessed path; add a regression test.

## Recovery and follow-up

- Confirm health endpoints clean and a full launch cycle works.
- Write a post-incident note: timeline, root cause, fixes, follow-up tasks.
- Add or update a runbook and a test so the same failure is caught earlier.
