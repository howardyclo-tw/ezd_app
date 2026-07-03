-- 011_pricing_voting_penalty.sql
-- Additive migration: courses pricing/enroll switches, allocation policy,
-- MV voting tables, penalty overrides table.
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. courses: unified pricing + enroll switches
-- ============================================================
ALTER TABLE courses ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'card';

-- CHECK constraint (idempotent: drop-then-add)
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_pricing_mode_chk;
ALTER TABLE courses ADD CONSTRAINT courses_pricing_mode_chk
  CHECK (pricing_mode IN ('card','ntd','free'));

ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_member_single integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_guest_single  integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_member_full   integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_guest_full    integer;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS enroll_full   boolean NOT NULL DEFAULT true;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS enroll_single boolean NOT NULL DEFAULT true;

-- ============================================================
-- 2. course_groups: allocation policy
-- ============================================================
ALTER TABLE course_groups ADD COLUMN IF NOT EXISTS allocation_policy text NOT NULL DEFAULT 'fcfs';

-- ============================================================
-- 3. enrollments: leader willingness + cancel reason + order ref
-- ============================================================
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS wants_leader  boolean NOT NULL DEFAULT false;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS order_id      uuid REFERENCES orders(id);

-- ============================================================
-- 4. MV voting tables
-- ============================================================

-- course_polls
CREATE TABLE IF NOT EXISTS course_polls (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  vote_type     text        NOT NULL,
  status        text        NOT NULL DEFAULT 'open',
  published_at  timestamptz,
  published_by  uuid        REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- CHECK constraints on course_polls (idempotent)
ALTER TABLE course_polls DROP CONSTRAINT IF EXISTS course_polls_vote_type_chk;
ALTER TABLE course_polls ADD CONSTRAINT course_polls_vote_type_chk
  CHECK (vote_type IN ('single','multi'));

ALTER TABLE course_polls DROP CONSTRAINT IF EXISTS course_polls_status_chk;
ALTER TABLE course_polls ADD CONSTRAINT course_polls_status_chk
  CHECK (status IN ('open','published'));

-- poll_options
CREATE TABLE IF NOT EXISTS poll_options (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     uuid    NOT NULL REFERENCES course_polls(id) ON DELETE CASCADE,
  label       text    NOT NULL,
  youtube_url text,
  is_winner   boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0
);

-- poll_votes
CREATE TABLE IF NOT EXISTS poll_votes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id       uuid        NOT NULL REFERENCES course_polls(id) ON DELETE CASCADE,
  option_id     uuid        NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES profiles(id),
  enrollment_id uuid        REFERENCES enrollments(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE constraint on poll_votes (idempotent)
ALTER TABLE poll_votes DROP CONSTRAINT IF EXISTS poll_votes_poll_id_user_id_option_id_key;
ALTER TABLE poll_votes ADD CONSTRAINT poll_votes_poll_id_user_id_option_id_key
  UNIQUE (poll_id, user_id, option_id);

-- ============================================================
-- 5. Penalty overrides table
-- ============================================================
CREATE TABLE IF NOT EXISTS penalty_overrides (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id),
  period_end  date        NOT NULL,
  reason      text,
  created_by  uuid        REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. RLS: enable + read policies for new tables
--    Mirrors enrollments pattern: authenticated can SELECT;
--    all writes go through adminClient (service role, bypasses RLS).
-- ============================================================
ALTER TABLE course_polls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options       ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalty_overrides  ENABLE ROW LEVEL SECURITY;

-- course_polls: any authenticated user can read
DROP POLICY IF EXISTS "Auth can view course_polls" ON course_polls;
CREATE POLICY "Auth can view course_polls" ON course_polls
  FOR SELECT TO authenticated USING (true);

-- poll_options: any authenticated user can read
DROP POLICY IF EXISTS "Auth can view poll_options" ON poll_options;
CREATE POLICY "Auth can view poll_options" ON poll_options
  FOR SELECT TO authenticated USING (true);

-- poll_votes: any authenticated user can read
DROP POLICY IF EXISTS "Auth can view poll_votes" ON poll_votes;
CREATE POLICY "Auth can view poll_votes" ON poll_votes
  FOR SELECT TO authenticated USING (true);

-- penalty_overrides: any authenticated user can read
DROP POLICY IF EXISTS "Auth can view penalty_overrides" ON penalty_overrides;
CREATE POLICY "Auth can view penalty_overrides" ON penalty_overrides
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 7. Backfill course defaults by type
-- ============================================================
-- workshop courses: ntd pricing, both full + single enrollment
UPDATE courses
   SET pricing_mode  = 'ntd',
       enroll_full   = true,
       enroll_single = true
 WHERE type = 'workshop';

-- style courses: ntd pricing, single-only enrollment
UPDATE courses
   SET pricing_mode  = 'ntd',
       enroll_full   = false,
       enroll_single = true
 WHERE type = 'style';

-- normal/trial/special: stay as default (card, both true) — no action needed
