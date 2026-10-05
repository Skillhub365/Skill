# Database (Supabase / Postgres)

## Tables

| Group | Tables |
| --- | --- |
| Tenancy & identity | `tenants`, `profiles`, `user_roles`, `workspace_users` |
| Catalog | `workspaces`, `templates`, `labs`, `lab_assignments` |
| Cloud | `cloud_connections`, `cloud_inventory`, `cloud_mappings`, `vm_records`, `vm_pool_entries` |
| Runtime | `sessions`, `session_events`, `lifecycle_events`, `gateway_connections`, `cleanup_runs` |
| Audit | `activity_logs` |

Helper functions: `has_role`, `is_admin`, `is_workspace_member`, `current_tenant`,
`same_tenant_workspace`, `touch_updated_at`, plus the atomic `allocate_pool_vm` claim.

## Connect a project

1. Create the Supabase/Cloud project for the environment (dev, staging, prod are separate).
2. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_*` equivalents and
   `SUPABASE_SERVICE_ROLE_KEY` (Key Vault in staging/production).
3. Apply migrations, then verify with the admin security console.

## Migrations

SQL files live in `supabase/migrations/` and are applied in filename order. Rules:

- One concern per migration; never edit an applied file — add a new one.
- Every `CREATE TABLE public.x` is followed, in the same migration, by GRANTs,
  `ENABLE ROW LEVEL SECURITY`, then policies.
- Use validation triggers instead of time-dependent CHECK constraints.
- No `ALTER DATABASE`.

## Types

`src/integrations/supabase/types.ts` is generated. Regenerate it after a schema
change rather than hand-editing; repositories are typed against it.

## RLS

Policies scope reads/writes to `auth.uid()`, workspace membership and tenant.
`anon` gets SELECT only where a public policy exists. The server uses the
service-role client (`src/integrations/supabase/client.server.ts`) exclusively
inside handlers, after `authorize()` has established the principal — never to
decide whether the caller is an admin.

## Seed / local data

Development seeds the catalog with sample tenants, workspaces, templates and labs.
Keep seed inserts inside migrations, not in page-load code.

## Rollback

Write a paired down-migration for anything destructive and test it against a
restored snapshot first. See [runbooks/database-migration-rollback.md](runbooks/database-migration-rollback.md).

## Backup / restore

Rely on managed point-in-time recovery; take an on-demand snapshot immediately
before any production migration and record the snapshot id in the change ticket.

## Production migration checklist

1. Migration reviewed, additive-first, GRANT + RLS present.
2. Snapshot taken and id recorded.
3. Applied to staging and smoke-tested.
4. Applied to production during a low-traffic window.
5. `npm run test` green; admin security console shows no RLS warnings.
6. Rollback path documented.
