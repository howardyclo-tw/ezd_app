-- Add Priority (Stage 1) registration periods to course_groups
-- Renamed from phase1_start/end to be more descriptive for business logic
ALTER TABLE public.course_groups
ADD COLUMN IF NOT EXISTS registration_phase1_start TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS registration_phase1_end TIMESTAMPTZ;

-- Comment to explain the purpose
COMMENT ON COLUMN public.course_groups.registration_phase1_start IS '第一階段報名開始時間 (預選/多堂報名時段)';
COMMENT ON COLUMN public.course_groups.registration_phase1_end IS '第一階段報名結束時間';
