-- ============ sessions: launch tracking, idempotency, cleanup retries ============
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS launch_key text,
  ADD COLUMN IF NOT EXISTS state_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_error text,
  ADD COLUMN IF NOT EXISTS gateway_cleaned_at timestamptz,
  ADD COLUMN IF NOT EXISTS vm_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS allocation_lock_token text;

DROP INDEX IF EXISTS public.sessions_live_user_lab_idx;

-- One live session per learner per lab: duplicate launches must reuse, never duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_live_user_lab_uniq
  ON public.sessions (user_id, lab_id)
  WHERE status IN ('REQUESTED','ALLOCATING','CREATING','STARTING','BOOTING','READY','ACTIVE','DISCONNECTING','STOPPING');

CREATE INDEX IF NOT EXISTS sessions_state_changed_idx ON public.sessions (status, state_changed_at);
CREATE INDEX IF NOT EXISTS sessions_launch_key_idx ON public.sessions (launch_key);

-- ============ durable VM pool ============
CREATE TABLE IF NOT EXISTS public.vm_pool_entries (
  id text PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_id text NOT NULL,
  template_name text NOT NULL,
  workspace_id text,
  lab_id text,
  cloud_connection_id text NOT NULL,
  cloud_connection_name text NOT NULL,
  subscription_id text NOT NULL,
  resource_group text NOT NULL,
  azure_resource_id text NOT NULL UNIQUE,
  azure_vm_name text NOT NULL,
  region text NOT NULL,
  vm_size text NOT NULL,
  image_version text,
  os_type text NOT NULL DEFAULT 'Windows',
  status text NOT NULL DEFAULT 'AVAILABLE',
  power_state text NOT NULL DEFAULT 'unknown',
  private_ip text,
  assigned_user_id text,
  assigned_user_name text,
  current_session_id text,
  allocation_lock_token text,
  allocation_expires_at timestamptz,
  orphaned boolean NOT NULL DEFAULT false,
  last_error text,
  last_synced_at timestamptz,
  mock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vm_pool_entries TO authenticated;
GRANT ALL ON public.vm_pool_entries TO service_role;
ALTER TABLE public.vm_pool_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vm_pool_entries_admin_read ON public.vm_pool_entries;
CREATE POLICY vm_pool_entries_admin_read ON public.vm_pool_entries
  FOR SELECT TO authenticated
  USING (
    app_private.has_role(auth.uid(), 'superadmin'::public.app_role)
    OR (app_private.is_admin(auth.uid()) AND (tenant_id IS NULL OR tenant_id = app_private.current_tenant()))
  );

DROP TRIGGER IF EXISTS vm_pool_entries_touch ON public.vm_pool_entries;
CREATE TRIGGER vm_pool_entries_touch BEFORE UPDATE ON public.vm_pool_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS vm_pool_template_status_idx ON public.vm_pool_entries (template_id, status);
CREATE INDEX IF NOT EXISTS vm_pool_session_idx ON public.vm_pool_entries (current_session_id);
CREATE INDEX IF NOT EXISTS vm_pool_alloc_expiry_idx ON public.vm_pool_entries (allocation_expires_at)
  WHERE allocation_expires_at IS NOT NULL;

-- ============ atomic allocation ============
CREATE OR REPLACE FUNCTION app_private.allocate_pool_vm(
  p_template_id text,
  p_workspace_id text,
  p_lab_id text,
  p_user_id text,
  p_user_name text,
  p_session_id text,
  p_lock_token text,
  p_lock_seconds integer DEFAULT 900
) RETURNS public.vm_pool_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_row public.vm_pool_entries;
BEGIN
  SELECT id INTO v_id
  FROM public.vm_pool_entries
  WHERE template_id = p_template_id
    AND status = 'AVAILABLE'
    AND current_session_id IS NULL
    AND (allocation_expires_at IS NULL OR allocation_expires_at < now())
    AND (workspace_id IS NULL OR p_workspace_id IS NULL OR workspace_id = p_workspace_id)
  ORDER BY (workspace_id = p_workspace_id) DESC NULLS LAST, updated_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.vm_pool_entries SET
    status = 'ALLOCATED',
    assigned_user_id = p_user_id,
    assigned_user_name = p_user_name,
    lab_id = p_lab_id,
    current_session_id = p_session_id,
    allocation_lock_token = p_lock_token,
    allocation_expires_at = now() + make_interval(secs => p_lock_seconds),
    orphaned = false,
    last_error = NULL,
    updated_at = now()
  WHERE id = v_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION app_private.allocate_pool_vm(text,text,text,text,text,text,text,integer) FROM public;

-- ============ capacity policy ============
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions integer,
  ADD COLUMN IF NOT EXISTS max_session_minutes integer;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions integer,
  ADD COLUMN IF NOT EXISTS max_session_minutes integer;

-- ============ cleanup / replay indexes ============
CREATE INDEX IF NOT EXISTS gateway_status_idx ON public.gateway_connections (status, updated_at);
CREATE INDEX IF NOT EXISTS cleanup_runs_job_idx ON public.cleanup_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS session_events_corr_idx ON public.session_events (correlation_id);