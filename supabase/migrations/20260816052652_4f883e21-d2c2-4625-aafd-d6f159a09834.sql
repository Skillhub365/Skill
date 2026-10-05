ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS lab_mode public.lab_mode NOT NULL DEFAULT 'session_based';

CREATE INDEX IF NOT EXISTS sessions_lab_mode_idx ON public.sessions (lab_mode);