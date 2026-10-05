-- Internal authorization helpers must not be callable over the Data API.
-- They live in a private schema that PostgREST does not expose; RLS policies
-- still call them, so signed-in roles keep USAGE/EXECUTE but have no RPC path.
create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.current_tenant()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tenant_id from public.profiles where id = auth.uid()
$function$;

create or replace function app_private.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$function$;

create or replace function app_private.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','superadmin'))
$function$;

create or replace function app_private.is_workspace_member(_user_id uuid, _workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.workspace_users
    where user_id = _user_id and workspace_id = _workspace_id and status = 'active'
  )
$function$;

create or replace function app_private.same_tenant_workspace(_user_id uuid, _workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.workspaces w
    join public.profiles p on p.id = _user_id
    where w.id = _workspace_id and w.tenant_id = p.tenant_id
  )
$function$;

revoke all on function app_private.current_tenant() from public;
revoke all on function app_private.has_role(uuid, public.app_role) from public;
revoke all on function app_private.is_admin(uuid) from public;
revoke all on function app_private.is_workspace_member(uuid, uuid) from public;
revoke all on function app_private.same_tenant_workspace(uuid, uuid) from public;

grant execute on function app_private.current_tenant() to authenticated, service_role;
grant execute on function app_private.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function app_private.is_admin(uuid) to authenticated, service_role;
grant execute on function app_private.is_workspace_member(uuid, uuid) to authenticated, service_role;
grant execute on function app_private.same_tenant_workspace(uuid, uuid) to authenticated, service_role;

-- Repoint every policy at the private helpers. Logic is unchanged.
drop policy if exists tenants_read_own on public.tenants;
create policy tenants_read_own on public.tenants for select to authenticated
  using (id = app_private.current_tenant());

drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated
  using (id = auth.uid() or (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant()));

drop policy if exists user_roles_read_self on public.user_roles;
create policy user_roles_read_self on public.user_roles for select to authenticated
  using (user_id = auth.uid() or (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant()));

drop policy if exists workspaces_read on public.workspaces;
create policy workspaces_read on public.workspaces for select to authenticated
  using (app_private.is_workspace_member(auth.uid(), id)
         or (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant()));

drop policy if exists workspace_users_read on public.workspace_users;
create policy workspace_users_read on public.workspace_users for select to authenticated
  using (user_id = auth.uid()
         or (app_private.is_admin(auth.uid()) and app_private.same_tenant_workspace(auth.uid(), workspace_id)));

drop policy if exists labs_read on public.labs;
create policy labs_read on public.labs for select to authenticated
  using ((app_private.is_workspace_member(auth.uid(), workspace_id) and status = 'published'::public.lab_status)
         or (app_private.is_admin(auth.uid()) and app_private.same_tenant_workspace(auth.uid(), workspace_id)));

drop policy if exists lab_assignments_read on public.lab_assignments;
create policy lab_assignments_read on public.lab_assignments for select to authenticated
  using (user_id = auth.uid()
         or (app_private.is_admin(auth.uid()) and app_private.same_tenant_workspace(auth.uid(), workspace_id)));

drop policy if exists templates_read on public.templates;
create policy templates_read on public.templates for select to authenticated
  using (tenant_id = app_private.current_tenant());

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select to authenticated
  using (user_id = auth.uid() or (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant()));

drop policy if exists session_events_read on public.session_events;
create policy session_events_read on public.session_events for select to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = session_events.session_id
      and (s.user_id = auth.uid() or (app_private.is_admin(auth.uid()) and s.tenant_id = app_private.current_tenant()))
  ));

drop policy if exists vm_records_read on public.vm_records;
create policy vm_records_read on public.vm_records for select to authenticated
  using (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant());

drop policy if exists activity_logs_read on public.activity_logs;
create policy activity_logs_read on public.activity_logs for select to authenticated
  using (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant());

drop policy if exists lifecycle_events_read on public.lifecycle_events;
create policy lifecycle_events_read on public.lifecycle_events for select to authenticated
  using (app_private.is_admin(auth.uid()) and tenant_id = app_private.current_tenant());

drop policy if exists cloud_connections_read on public.cloud_connections;
create policy cloud_connections_read on public.cloud_connections for select to authenticated
  using (app_private.has_role(auth.uid(), 'superadmin'::public.app_role) and tenant_id = app_private.current_tenant());

drop policy if exists cloud_inventory_read on public.cloud_inventory;
create policy cloud_inventory_read on public.cloud_inventory for select to authenticated
  using (app_private.has_role(auth.uid(), 'superadmin'::public.app_role));

drop policy if exists cloud_mappings_read on public.cloud_mappings;
create policy cloud_mappings_read on public.cloud_mappings for select to authenticated
  using (app_private.has_role(auth.uid(), 'superadmin'::public.app_role) and tenant_id = app_private.current_tenant());

-- The publicly reachable copies are no longer referenced anywhere.
drop function if exists public.same_tenant_workspace(uuid, uuid);
drop function if exists public.is_workspace_member(uuid, uuid);
drop function if exists public.is_admin(uuid);
drop function if exists public.has_role(uuid, public.app_role);
drop function if exists public.current_tenant();