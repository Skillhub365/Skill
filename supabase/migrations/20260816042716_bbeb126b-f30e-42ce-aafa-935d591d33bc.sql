ALTER TABLE public.sessions REPLICA IDENTITY FULL;
ALTER TABLE public.session_events REPLICA IDENTITY FULL;
ALTER TABLE public.lifecycle_events REPLICA IDENTITY FULL;
ALTER TABLE public.vm_records REPLICA IDENTITY FULL;
ALTER TABLE public.vm_pool_entries REPLICA IDENTITY FULL;
ALTER TABLE public.gateway_connections REPLICA IDENTITY FULL;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;
ALTER TABLE public.cloud_connections REPLICA IDENTITY FULL;
ALTER TABLE public.cloud_inventory REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sessions','session_events','lifecycle_events','vm_records','vm_pool_entries',
    'gateway_connections','activity_logs','cloud_connections','cloud_inventory'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_rel pr
      JOIN pg_publication p ON p.oid = pr.prpubid
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;