ALTER TABLE public.gateway_connections
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS gateway_connections_stale_idx
  ON public.gateway_connections (expires_at) WHERE cleaned_up_at IS NULL;