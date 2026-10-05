-- ============ enums ============
create type public.app_role as enum ('superadmin','admin','user');
create type public.account_status as enum ('active','invited','suspended','disabled');
create type public.workspace_status as enum ('active','draft','archived','suspended');
create type public.access_type as enum ('WORKSPACE_URL','USER_SESSION_URL');
create type public.cloud_provider as enum ('azure');
create type public.template_status as enum ('draft','active','archived');
create type public.lab_status as enum ('draft','configured','published','archived');
create type public.assignment_status as enum ('assigned','in_progress','completed','revoked');
create type public.pool_vm_status as enum ('AVAILABLE','ALLOCATED','STARTING','READY','IN_USE','STOPPING','STOPPED','ERROR','RETIRED');
create type public.session_status as enum ('PENDING','ACTIVE','EXPIRED','STOPPED','ERROR');
create type public.gateway_status as enum ('PENDING','CONNECTING','CONNECTED','DISCONNECTED','ERROR','CLEANED');
create type public.connection_health as enum ('unknown','healthy','degraded','failed');

-- ============ helpers ============
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

-- ============ tenants ============
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active',
  plan text not null default 'standard',
  monthly_budget_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.tenants to authenticated;
grant all on public.tenants to service_role;
alter table public.tenants enable row level security;

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  email text not null,
  full_name text,
  status public.account_status not null default 'active',
  entra_object_id text,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ============ roles ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role in ('admin','superadmin'))
$$;

create or replace function public.current_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

-- ============ workspaces ============
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  organization_name text not null,
  slug text not null unique,
  status public.workspace_status not null default 'active',
  access_type public.access_type not null default 'WORKSPACE_URL',
  public_landing jsonb not null default '{}'::jsonb,
  default_template_id uuid,
  cloud_connection_id uuid,
  monthly_budget_cents bigint,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;

create table public.workspace_users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'user',
  status public.account_status not null default 'active',
  capabilities text[] not null default '{}',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
grant select on public.workspace_users to authenticated;
grant all on public.workspace_users to service_role;
alter table public.workspace_users enable row level security;

create or replace function public.is_workspace_member(_user_id uuid, _workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_users
    where user_id = _user_id and workspace_id = _workspace_id and status = 'active'
  )
$$;

create or replace function public.same_tenant_workspace(_user_id uuid, _workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
    join public.profiles p on p.id = _user_id
    where w.id = _workspace_id and w.tenant_id = p.tenant_id
  )
$$;

-- ============ cloud connections ============
create table public.cloud_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  provider public.cloud_provider not null default 'azure',
  azure_tenant_id text not null,
  subscription_id text not null,
  client_id text not null,
  secret_ref text not null,
  secret_rotated_at timestamptz,
  status text not null default 'active',
  health public.connection_health not null default 'unknown',
  health_detail text,
  last_validated_at timestamptz,
  refresh_enabled boolean not null default true,
  refresh_interval_seconds int not null default 300,
  last_refreshed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, subscription_id)
);
grant select on public.cloud_connections to authenticated;
grant all on public.cloud_connections to service_role;
alter table public.cloud_connections enable row level security;

create table public.cloud_inventory (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.cloud_connections(id) on delete cascade,
  resource_type text not null,
  azure_resource_id text not null,
  name text not null,
  resource_group text,
  region text,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (connection_id, azure_resource_id)
);
grant select on public.cloud_inventory to authenticated;
grant all on public.cloud_inventory to service_role;
alter table public.cloud_inventory enable row level security;

create table public.cloud_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.cloud_connections(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  azure_resource_id text not null,
  resource_kind text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, resource_kind)
);
grant select on public.cloud_mappings to authenticated;
grant all on public.cloud_mappings to service_role;
alter table public.cloud_mappings enable row level security;

-- ============ templates ============
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cloud_connection_id uuid references public.cloud_connections(id) on delete set null,
  name text not null,
  description text,
  cloud_provider public.cloud_provider not null default 'azure',
  operating_system text not null,
  vm_size text not null,
  region text not null,
  image text not null,
  gallery_resource_group text,
  gallery_name text,
  image_definition text,
  image_version text,
  image_resource_id text,
  configuration jsonb not null default '{}'::jsonb,
  status public.template_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.templates to authenticated;
grant all on public.templates to service_role;
alter table public.templates enable row level security;

alter table public.workspaces
  add constraint workspaces_default_template_fk foreign key (default_template_id) references public.templates(id) on delete set null,
  add constraint workspaces_cloud_connection_fk foreign key (cloud_connection_id) references public.cloud_connections(id) on delete set null;

-- ============ labs ============
create table public.labs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid references public.templates(id) on delete restrict,
  title text not null,
  description text,
  instructions text,
  status public.lab_status not null default 'draft',
  duration_minutes int not null default 120,
  max_extensions int not null default 2,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.labs to authenticated;
grant all on public.labs to service_role;
alter table public.labs enable row level security;

create table public.lab_assignments (
  id uuid primary key default gen_random_uuid(),
  lab_id uuid not null references public.labs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.assignment_status not null default 'assigned',
  progress jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lab_id, user_id)
);
grant select on public.lab_assignments to authenticated;
grant all on public.lab_assignments to service_role;
alter table public.lab_assignments enable row level security;

-- ============ vm pool ============
create table public.vm_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.cloud_connections(id) on delete cascade,
  template_id uuid references public.templates(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  name text not null,
  azure_vm_name text not null,
  azure_resource_id text not null unique,
  resource_group text not null,
  region text not null,
  vm_size text not null,
  private_ip text,
  status public.pool_vm_status not null default 'AVAILABLE',
  power_state text,
  current_session_id uuid,
  assigned_user_id uuid references auth.users(id) on delete set null,
  allocation_lock_token text,
  allocation_locked_until timestamptz,
  last_error text,
  last_synced_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.vm_records to authenticated;
grant all on public.vm_records to service_role;
alter table public.vm_records enable row level security;

-- ============ sessions ============
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lab_id uuid not null references public.labs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vm_id uuid references public.vm_records(id) on delete set null,
  status public.session_status not null default 'PENDING',
  correlation_id text not null default gen_random_uuid()::text,
  duration_minutes int not null default 120,
  extended_minutes int not null default 0,
  extension_count int not null default 0,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_active_idx on public.sessions (status, expires_at);
create index sessions_user_idx on public.sessions (user_id, status);
grant select on public.sessions to authenticated;
grant all on public.sessions to service_role;
alter table public.sessions enable row level security;

alter table public.vm_records
  add constraint vm_records_session_fk foreign key (current_session_id) references public.sessions(id) on delete set null;

create table public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  at timestamptz not null default now(),
  event_type text not null,
  phase text,
  message text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb
);
create index session_events_session_idx on public.session_events (session_id, at desc);
grant select on public.session_events to authenticated;
grant all on public.session_events to service_role;
alter table public.session_events enable row level security;

-- ============ gateway ============
create table public.gateway_connections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  vm_id uuid references public.vm_records(id) on delete set null,
  guac_connection_id text,
  guac_username text,
  guac_user_created_at timestamptz,
  status public.gateway_status not null default 'PENDING',
  token_expires_at timestamptz,
  cleaned_up_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gateway_session_idx on public.gateway_connections (session_id);
grant select on public.gateway_connections to authenticated;
grant all on public.gateway_connections to service_role;
alter table public.gateway_connections enable row level security;

-- ============ observability ============
create table public.lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  at timestamptz not null default now(),
  entity_type text not null,
  entity_id text not null,
  phase text not null,
  status text not null default 'info',
  correlation_id text,
  duration_ms int,
  detail text,
  metadata jsonb not null default '{}'::jsonb
);
create index lifecycle_entity_idx on public.lifecycle_events (entity_type, entity_id, at desc);
grant select on public.lifecycle_events to authenticated;
grant all on public.lifecycle_events to service_role;
alter table public.lifecycle_events enable row level security;

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  workspace_id uuid references public.workspaces(id) on delete set null,
  outcome text not null default 'success',
  error_code text,
  detail text,
  correlation_id text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb
);
create index activity_tenant_idx on public.activity_logs (tenant_id, at desc);
grant select on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;
alter table public.activity_logs enable row level security;

-- ============ updated_at triggers ============
do $$
declare t text;
begin
  foreach t in array array['tenants','profiles','workspaces','workspace_users','cloud_connections','templates','labs','lab_assignments','vm_records','sessions','gateway_connections']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ============ policies ============
-- tenants: read your own tenant
create policy tenants_read_own on public.tenants for select to authenticated
  using (id = public.current_tenant());

-- profiles: read self; admins read tenant peers; update self only (non-privileged fields enforced server-side)
create policy profiles_read_self on public.profiles for select to authenticated
  using (id = auth.uid() or (public.is_admin(auth.uid()) and tenant_id = public.current_tenant()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- roles: read own roles only; writes are service_role only
create policy user_roles_read_self on public.user_roles for select to authenticated
  using (user_id = auth.uid() or (public.is_admin(auth.uid()) and tenant_id = public.current_tenant()));

-- workspaces
create policy workspaces_read on public.workspaces for select to authenticated
  using (public.is_workspace_member(auth.uid(), id)
         or (public.is_admin(auth.uid()) and tenant_id = public.current_tenant()));

create policy workspace_users_read on public.workspace_users for select to authenticated
  using (user_id = auth.uid()
         or (public.is_admin(auth.uid()) and public.same_tenant_workspace(auth.uid(), workspace_id)));

-- templates: tenant-scoped read
create policy templates_read on public.templates for select to authenticated
  using (tenant_id = public.current_tenant());

-- labs: published labs in workspaces you belong to, or admin in tenant
create policy labs_read on public.labs for select to authenticated
  using ((public.is_workspace_member(auth.uid(), workspace_id) and status = 'published')
         or (public.is_admin(auth.uid()) and public.same_tenant_workspace(auth.uid(), workspace_id)));

create policy lab_assignments_read on public.lab_assignments for select to authenticated
  using (user_id = auth.uid()
         or (public.is_admin(auth.uid()) and public.same_tenant_workspace(auth.uid(), workspace_id)));

-- cloud: super admins only
create policy cloud_connections_read on public.cloud_connections for select to authenticated
  using (public.has_role(auth.uid(),'superadmin') and tenant_id = public.current_tenant());
create policy cloud_inventory_read on public.cloud_inventory for select to authenticated
  using (public.has_role(auth.uid(),'superadmin'));
create policy cloud_mappings_read on public.cloud_mappings for select to authenticated
  using (public.has_role(auth.uid(),'superadmin') and tenant_id = public.current_tenant());

-- vm pool: admins in tenant (learners never read VM rows directly)
create policy vm_records_read on public.vm_records for select to authenticated
  using (public.is_admin(auth.uid()) and tenant_id = public.current_tenant());

-- sessions: own sessions, or admins in tenant
create policy sessions_read on public.sessions for select to authenticated
  using (user_id = auth.uid() or (public.is_admin(auth.uid()) and tenant_id = public.current_tenant()));

create policy session_events_read on public.session_events for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id
                 and (s.user_id = auth.uid() or (public.is_admin(auth.uid()) and s.tenant_id = public.current_tenant()))));

-- gateway records are never readable by the browser (server_role only): no policy

-- observability: admins in tenant
create policy lifecycle_events_read on public.lifecycle_events for select to authenticated
  using (public.is_admin(auth.uid()) and tenant_id = public.current_tenant());
create policy activity_logs_read on public.activity_logs for select to authenticated
  using (public.is_admin(auth.uid()) and tenant_id = public.current_tenant());

-- ============ new user bootstrap ============
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, entra_object_id, last_sign_in_at)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.raw_user_meta_data->>'provider_id', now())
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'user')
  on conflict (user_id, role) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();