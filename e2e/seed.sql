-- ============================================================
-- e2e/seed.sql
-- Deterministic E2E seed for Phase 0.3 regression baseline.
-- Idempotent: all INSERTs use ON CONFLICT ... DO UPDATE.
-- Prereq: run  node e2e/seed-users.mjs  first (creates auth users).
-- IDs are resolved via subselects on auth.users.email.
-- Target: DEV Supabase project mvxdxldwznbqycfgwqmc ONLY.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Member Group  (valid until 2026-12-31)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.member_groups (id, name, valid_until)
VALUES (
  'e2e00000-0000-0000-0000-000000000001',
  'E2E Test Group 2026',
  '2026-12-31'
)
ON CONFLICT (id) DO UPDATE SET
  name       = EXCLUDED.name,
  valid_until = EXCLUDED.valid_until;

-- ────────────────────────────────────────────────────────────
-- 2. Profiles  (trigger already created rows; we UPDATE them)
-- ────────────────────────────────────────────────────────────
-- Admin
UPDATE public.profiles SET
  name              = 'E2E Admin',
  role              = 'admin',
  card_balance      = 0,
  makeup_quota      = 0,
  member_valid_until = '2026-12-31',
  member_group_id   = NULL
WHERE id = (SELECT id FROM auth.users WHERE email = 'e2e-admin@mediatek.com');

-- Member (linked to the test member_group, 10 card balance)
UPDATE public.profiles SET
  name              = 'E2E Member',
  role              = 'member',
  card_balance      = 10,
  makeup_quota      = 0,
  member_valid_until = '2026-12-31',
  member_group_id   = 'e2e00000-0000-0000-0000-000000000001'
WHERE id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com');

-- Guest
UPDATE public.profiles SET
  name              = 'E2E Guest',
  role              = 'guest',
  card_balance      = 0,
  makeup_quota      = 0,
  member_valid_until = NULL,
  member_group_id   = NULL
WHERE id = (SELECT id FROM auth.users WHERE email = 'e2e-guest@mediatek.com');

-- ────────────────────────────────────────────────────────────
-- 3. Course Group  (period around "now", registration open)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.course_groups (id, title, description, region, period_start, period_end,
                                   registration_phase1_start, registration_phase1_end)
VALUES (
  'e2e00000-0000-0000-0000-000000000010',
  'E2E H2 2026 Course Group',
  'Deterministic E2E test course group',
  'HQ',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '90 days',
  NOW() - INTERVAL '1 day',
  NOW() + INTERVAL '7 days'
)
ON CONFLICT (id) DO UPDATE SET
  title                     = EXCLUDED.title,
  description               = EXCLUDED.description,
  region                    = EXCLUDED.region,
  period_start              = EXCLUDED.period_start,
  period_end                = EXCLUDED.period_end,
  registration_phase1_start = EXCLUDED.registration_phase1_start,
  registration_phase1_end   = EXCLUDED.registration_phase1_end;

-- ────────────────────────────────────────────────────────────
-- 4. Course  (normal, card-mode, capacity 20)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.courses (id, group_id, name, description, type, teacher, room,
                            start_time, end_time, capacity, cards_per_session,
                            enrollment_start_at, enrollment_end_at)
VALUES (
  'e2e00000-0000-0000-0000-000000000020',
  'e2e00000-0000-0000-0000-000000000010',
  'E2E Basic Groove',
  'E2E regression test course',
  'normal',
  'E2E Teacher',
  'E2E Room',
  '19:00',
  '20:30',
  20,
  1,
  NOW() - INTERVAL '1 day',
  NOW() + INTERVAL '30 days'
)
ON CONFLICT (id) DO UPDATE SET
  group_id           = EXCLUDED.group_id,
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  type               = EXCLUDED.type,
  teacher            = EXCLUDED.teacher,
  room               = EXCLUDED.room,
  start_time         = EXCLUDED.start_time,
  end_time           = EXCLUDED.end_time,
  capacity           = EXCLUDED.capacity,
  cards_per_session   = EXCLUDED.cards_per_session,
  enrollment_start_at = EXCLUDED.enrollment_start_at,
  enrollment_end_at   = EXCLUDED.enrollment_end_at;

-- ────────────────────────────────────────────────────────────
-- 5. Course Sessions  (1 past + 3 future sessions)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.course_sessions (id, course_id, session_date, session_number, is_cancelled)
VALUES
  ('e2e00000-0000-0000-0000-000000000030',
   'e2e00000-0000-0000-0000-000000000020',
   CURRENT_DATE - INTERVAL '7 days',  0, FALSE),
  ('e2e00000-0000-0000-0000-000000000031',
   'e2e00000-0000-0000-0000-000000000020',
   CURRENT_DATE + INTERVAL '7 days',  1, FALSE),
  ('e2e00000-0000-0000-0000-000000000032',
   'e2e00000-0000-0000-0000-000000000020',
   CURRENT_DATE + INTERVAL '14 days', 2, FALSE),
  ('e2e00000-0000-0000-0000-000000000033',
   'e2e00000-0000-0000-0000-000000000020',
   CURRENT_DATE + INTERVAL '21 days', 3, FALSE)
ON CONFLICT (id) DO UPDATE SET
  course_id      = EXCLUDED.course_id,
  session_date   = EXCLUDED.session_date,
  session_number = EXCLUDED.session_number,
  is_cancelled   = EXCLUDED.is_cancelled;

-- ────────────────────────────────────────────────────────────
-- 4b. Second Course  (for single-session enrollment test)
--     Member is NOT pre-enrolled here; 3 future sessions.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.courses (id, group_id, name, description, type, teacher, room,
                            start_time, end_time, capacity, cards_per_session,
                            enrollment_start_at, enrollment_end_at)
VALUES (
  'e2e00000-0000-0000-0000-000000000021',
  'e2e00000-0000-0000-0000-000000000010',
  'E2E Single Course',
  'E2E single-session enrollment test course',
  'normal',
  'E2E Teacher',
  'E2E Room',
  '20:00',
  '21:30',
  20,
  1,
  NOW() - INTERVAL '1 day',
  NOW() + INTERVAL '30 days'
)
ON CONFLICT (id) DO UPDATE SET
  group_id           = EXCLUDED.group_id,
  name               = EXCLUDED.name,
  description        = EXCLUDED.description,
  type               = EXCLUDED.type,
  teacher            = EXCLUDED.teacher,
  room               = EXCLUDED.room,
  start_time         = EXCLUDED.start_time,
  end_time           = EXCLUDED.end_time,
  capacity           = EXCLUDED.capacity,
  cards_per_session   = EXCLUDED.cards_per_session,
  enrollment_start_at = EXCLUDED.enrollment_start_at,
  enrollment_end_at   = EXCLUDED.enrollment_end_at;

-- ────────────────────────────────────────────────────────────
-- 5a2. Sessions for E2E Single Course (3 future sessions)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.course_sessions (id, course_id, session_date, session_number, is_cancelled)
VALUES
  ('e2e00000-0000-0000-0000-000000000034',
   'e2e00000-0000-0000-0000-000000000021',
   CURRENT_DATE + INTERVAL '8 days',  1, FALSE),
  ('e2e00000-0000-0000-0000-000000000035',
   'e2e00000-0000-0000-0000-000000000021',
   CURRENT_DATE + INTERVAL '15 days', 2, FALSE),
  ('e2e00000-0000-0000-0000-000000000036',
   'e2e00000-0000-0000-0000-000000000021',
   CURRENT_DATE + INTERVAL '22 days', 3, FALSE)
ON CONFLICT (id) DO UPDATE SET
  course_id      = EXCLUDED.course_id,
  session_date   = EXCLUDED.session_date,
  session_number = EXCLUDED.session_number,
  is_cancelled   = EXCLUDED.is_cancelled;

-- ────────────────────────────────────────────────────────────
-- 5b. Full enrollment for the member (covers all sessions)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.enrollments (id, course_id, user_id, status, type, session_id, source)
VALUES (
  'e2e00000-0000-0000-0000-000000000060',
  'e2e00000-0000-0000-0000-000000000020',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'enrolled',
  'full',
  NULL,
  'self'
)
ON CONFLICT (id) DO UPDATE SET
  course_id  = EXCLUDED.course_id,
  user_id    = EXCLUDED.user_id,
  status     = EXCLUDED.status,
  type       = EXCLUDED.type,
  session_id = EXCLUDED.session_id,
  source     = EXCLUDED.source;

-- ────────────────────────────────────────────────────────────
-- 5c. Cleanup: remove non-seed enrollments, leave requests,
--     attendance records, card orders/transactions for idempotency
-- ────────────────────────────────────────────────────────────
DELETE FROM public.leave_requests
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND session_id IN (SELECT id FROM public.course_sessions
                     WHERE course_id IN ('e2e00000-0000-0000-0000-000000000020',
                                         'e2e00000-0000-0000-0000-000000000021'));

DELETE FROM public.attendance_records
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND session_id IN (SELECT id FROM public.course_sessions
                     WHERE course_id IN ('e2e00000-0000-0000-0000-000000000020',
                                         'e2e00000-0000-0000-0000-000000000021'));

DELETE FROM public.enrollments
WHERE course_id = 'e2e00000-0000-0000-0000-000000000020'
  AND id != 'e2e00000-0000-0000-0000-000000000060';

-- Remove card transactions tied to the single-course enrollments (FK dep)
DELETE FROM public.card_transactions
WHERE enrollment_id IN (SELECT id FROM public.enrollments
                        WHERE course_id = 'e2e00000-0000-0000-0000-000000000021');

-- Remove all enrollments for the single-course (no seed enrollment there)
DELETE FROM public.enrollments
WHERE course_id = 'e2e00000-0000-0000-0000-000000000021';

DELETE FROM public.orders
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND id != 'e2e00000-0000-0000-0000-000000000040';

DELETE FROM public.card_transactions
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND id != 'e2e00000-0000-0000-0000-000000000050';

-- ────────────────────────────────────────────────────────────
-- 6. Card Order  (confirmed, 10 cards for e2e-member)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.orders (id, user_id, quantity, used, unit_price, total_amount,
                                 status, expires_at, confirmed_at, confirmed_by, order_type)
VALUES (
  'e2e00000-0000-0000-0000-000000000040',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  10,
  0,
  270,
  2700,
  'confirmed',
  '2026-12-31',
  NOW(),
  (SELECT id FROM auth.users WHERE email = 'e2e-admin@mediatek.com'),
  'card_purchase'
)
ON CONFLICT (id) DO UPDATE SET
  user_id      = EXCLUDED.user_id,
  quantity     = EXCLUDED.quantity,
  used         = EXCLUDED.used,
  unit_price   = EXCLUDED.unit_price,
  total_amount = EXCLUDED.total_amount,
  status       = EXCLUDED.status,
  expires_at   = EXCLUDED.expires_at,
  confirmed_at = EXCLUDED.confirmed_at,
  confirmed_by = EXCLUDED.confirmed_by,
  order_type   = EXCLUDED.order_type;

-- ────────────────────────────────────────────────────────────
-- 7. Card Transaction  (purchase ledger entry for the order)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.card_transactions (id, user_id, type, amount, balance_after,
                                       order_id, note, created_by)
VALUES (
  'e2e00000-0000-0000-0000-000000000050',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'purchase',
  10,
  10,
  'e2e00000-0000-0000-0000-000000000040',
  'E2E seed: 10 cards purchased',
  (SELECT id FROM auth.users WHERE email = 'e2e-admin@mediatek.com')
)
ON CONFLICT (id) DO UPDATE SET
  user_id       = EXCLUDED.user_id,
  type          = EXCLUDED.type,
  amount        = EXCLUDED.amount,
  balance_after = EXCLUDED.balance_after,
  order_id      = EXCLUDED.order_id,
  note          = EXCLUDED.note,
  created_by    = EXCLUDED.created_by;

-- ============================================================
-- Done. Verify with:
--   SELECT name, role, card_balance FROM profiles
--   WHERE id IN (SELECT id FROM auth.users
--                WHERE email LIKE 'e2e-%@mediatek.com');
-- ============================================================
