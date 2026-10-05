create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

grant all on public.platform_settings to service_role;

alter table public.platform_settings enable row level security;