CREATE TYPE public.lab_mode AS ENUM ('session_based', 'persistent');
CREATE TYPE public.persistence_policy AS ENUM ('keep_vm', 'keep_disk', 'snapshot_restore');

ALTER TABLE public.labs
  ADD COLUMN lab_mode public.lab_mode NOT NULL DEFAULT 'session_based',
  ADD COLUMN default_access_days integer NOT NULL DEFAULT 10,
  ADD COLUMN default_allowed_minutes integer NOT NULL DEFAULT 1200,
  ADD COLUMN idle_shutdown_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN persistence_policy public.persistence_policy NOT NULL DEFAULT 'keep_disk',
  ADD COLUMN reset_on_access_end boolean NOT NULL DEFAULT true;

ALTER TABLE public.lab_assignments
  ADD COLUMN access_starts_at timestamp with time zone,
  ADD COLUMN access_ends_at timestamp with time zone,
  ADD COLUMN allowed_minutes integer,
  ADD COLUMN used_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN remaining_minutes integer GENERATED ALWAYS AS (GREATEST(COALESCE(allowed_minutes, 0) - used_minutes, 0)) STORED,
  ADD COLUMN persistent_vm_id text,
  ADD COLUMN last_started_at timestamp with time zone,
  ADD COLUMN last_stopped_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS lab_assignments_persistent_vm_idx
  ON public.lab_assignments (persistent_vm_id)
  WHERE persistent_vm_id IS NOT NULL;

ALTER TABLE public.sessions
  ADD COLUMN billable_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN assignment_id uuid REFERENCES public.lab_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sessions_assignment_idx ON public.sessions (assignment_id);