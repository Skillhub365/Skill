ALTER TABLE public.vm_pool_entries
  ADD COLUMN IF NOT EXISTS last_azure_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_type text,
  ADD COLUMN IF NOT EXISTS last_event_source text,
  ADD COLUMN IF NOT EXISTS drift_detected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drift_detail text,
  ADD COLUMN IF NOT EXISTS azure_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

ALTER TABLE public.cloud_connections
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_source text,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconcile_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS vm_pool_entries_azure_resource_idx
  ON public.vm_pool_entries (lower(azure_resource_id));