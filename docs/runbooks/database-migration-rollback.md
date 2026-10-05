# Runbook: database migration rollback

## Symptoms

Errors right after a release: permission denied on a table, missing column, RLS
denying legitimate reads, or a repository throwing on an unknown relation.

## Investigate

1. Which migration landed last (`supabase/migrations/`, applied order).
2. Supabase logs for the exact SQL error and any `HINT`.
3. Whether the failure is a missing GRANT (permission denied) rather than schema.

## Remediate

- **Missing GRANT / policy** — forward-fix with a new migration adding the GRANT or policy
  verbatim from the hint. Faster and safer than rolling back.
- **Additive change causing errors** — redeploy the previous app build; the extra column
  is harmless and can be removed later.
- **Destructive change** — restore from the pre-migration snapshot:
  1. Put the app into maintenance (stop new launches).
  2. Restore the snapshot to a new database and validate.
  3. Cut over, then re-apply only the safe migrations.
  4. Reconcile VM pool state with Azure via Sync — machines may have changed since the snapshot.

## Verify

`npm run test` green, admin security console clean, a full launch → connect → stop cycle
succeeds, and RLS still blocks cross-tenant reads.

## Escalation

Any restore that loses committed sessions is an incident —
follow [incident-response.md](incident-response.md).
