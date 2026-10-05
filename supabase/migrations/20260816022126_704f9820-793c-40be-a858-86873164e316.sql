CREATE TABLE IF NOT EXISTS public.metric_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  metric text NOT NULL,
  value numeric NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'count',
  outcome text,
  tenant_id uuid,
  workspace_id uuid,
  lab_id uuid,
  user_id uuid,
  session_id uuid,
  vm_id text,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.metric_events TO authenticated;
GRANT ALL ON public.metric_events TO service_role;

ALTER TABLE public.metric_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read metric events" ON public.metric_events;
CREATE POLICY "Admins can read metric events"
ON public.metric_events FOR SELECT TO authenticated
USING (app_private.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS metric_events_metric_at_idx ON public.metric_events (metric, at DESC);
CREATE INDEX IF NOT EXISTS metric_events_tenant_at_idx ON public.metric_events (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS metric_events_workspace_at_idx ON public.metric_events (workspace_id, at DESC);

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS vm_size text,
  ADD COLUMN IF NOT EXISTS hourly_rate_cents integer;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS monthly_vm_hour_budget integer;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS monthly_vm_hour_budget integer;