-- Migration 008: Add enrollment type and session_id for single-session enrollment

ALTER TABLE public.enrollments 
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'full' CHECK (type IN ('full', 'single')),
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.course_sessions(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.enrollments.type IS 'full-term enrollment (default) or single-session enrollment';
COMMENT ON COLUMN public.enrollments.session_id IS 'Specific session ID if enrollment is of type "single"';

-- Add index for session_id
CREATE INDEX IF NOT EXISTS idx_enrollments_session_id ON public.enrollments(session_id);

-- Add a constraint to ensure single-session enrollments have a session_id
-- (Optional, but good for data integrity)
-- ALTER TABLE public.enrollments ADD CONSTRAINT check_single_session_id 
--   CHECK ((type = 'single' AND session_id IS NOT NULL) OR (type = 'full'));
