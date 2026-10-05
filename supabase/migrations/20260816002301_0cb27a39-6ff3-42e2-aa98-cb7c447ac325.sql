-- Session records become the durable source of truth for live sessions.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_vm_id_fkey;

ALTER TABLE public.sessions
  ALTER COLUMN vm_id TYPE text USING vm_id::text;

-- Lifecycle states are owned by the orchestrator; store them as text so new
-- phases can be introduced without an enum migration.
ALTER TABLE public.sessions
  ALTER COLUMN status TYPE text USING status::text;

ALTER TABLE public.sessions
  ALTER COLUMN status SET DEFAULT 'CREATING';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS vm_name text,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'Azure',
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS max_extension_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS workspace_slug text,
  ADD COLUMN IF NOT EXISTS lab_title text,
  ADD COLUMN IF NOT EXISTS workspace_name text,
  ADD COLUMN IF NOT EXISTS user_name text;

CREATE INDEX IF NOT EXISTS sessions_live_user_lab_idx
  ON public.sessions (user_id, lab_id)
  WHERE status IN ('CREATING','STARTING','ACTIVE','DISCONNECTING');

CREATE INDEX IF NOT EXISTS sessions_vm_idx ON public.sessions (vm_id);
CREATE INDEX IF NOT EXISTS sessions_status_expiry_idx ON public.sessions (status, expires_at);
CREATE INDEX IF NOT EXISTS labs_workspace_status_idx ON public.labs (workspace_id, status);
CREATE INDEX IF NOT EXISTS lab_assignments_user_lab_idx ON public.lab_assignments (user_id, lab_id);
CREATE INDEX IF NOT EXISTS workspace_users_user_idx ON public.workspace_users (user_id, status);

-- Development seed: one organisation, template, workspace and published lab.
DO $$
DECLARE
  v_tenant uuid;
  v_owner uuid;
  v_template uuid;
  v_workspace uuid;
  v_lab uuid;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'skilltrack-labs';
  IF v_tenant IS NULL THEN
    INSERT INTO public.tenants (name, slug) VALUES ('SkillTrack Labs', 'skilltrack-labs') RETURNING id INTO v_tenant;
  END IF;

  SELECT id INTO v_owner FROM public.profiles WHERE email = 'admin@skillbridge365.co.in';

  SELECT id INTO v_template FROM public.templates WHERE tenant_id = v_tenant AND name = 'Windows 11 Developer Desktop';
  IF v_template IS NULL THEN
    INSERT INTO public.templates (tenant_id, name, description, cloud_provider, operating_system, vm_size, region, image, status, created_by)
    VALUES (v_tenant, 'Windows 11 Developer Desktop', 'Windows 11 with developer tooling preinstalled.',
            'azure', 'Windows 11', 'Standard_D4s_v5', 'eastus', 'skilltrack/win11-dev:latest', 'active', v_owner)
    RETURNING id INTO v_template;
  END IF;

  SELECT id INTO v_workspace FROM public.workspaces WHERE tenant_id = v_tenant AND slug = 'skilltrack-labs-academy';
  IF v_workspace IS NULL THEN
    INSERT INTO public.workspaces (tenant_id, name, description, organization_name, slug, status, access_type, default_template_id, created_by)
    VALUES (v_tenant, 'SkillTrack Academy', 'Starter workspace for local development.', 'SkillTrack Labs',
            'skilltrack-labs-academy', 'active', 'WORKSPACE_URL', v_template, v_owner)
    RETURNING id INTO v_workspace;
  END IF;

  SELECT id INTO v_lab FROM public.labs WHERE workspace_id = v_workspace AND title = 'Windows Desktop Fundamentals';
  IF v_lab IS NULL THEN
    INSERT INTO public.labs (workspace_id, template_id, title, description, status, duration_minutes, max_extensions, published_at, created_by)
    VALUES (v_workspace, v_template, 'Windows Desktop Fundamentals',
            'Explore the Windows desktop, tooling and file system in a disposable cloud machine.',
            'published', 120, 2, now(), v_owner)
    RETURNING id INTO v_lab;
  END IF;

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.workspace_users (workspace_id, user_id, role, status, capabilities, invited_by, accepted_at)
    VALUES (v_workspace, v_owner, 'admin', 'active', ARRAY['workspace:manage','lab:manage','user:manage'], v_owner, now())
    ON CONFLICT DO NOTHING;
  END IF;
END $$;