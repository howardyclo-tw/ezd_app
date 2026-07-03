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

-- Member2 (transfer recipient)
UPDATE public.profiles SET
  name              = 'E2E Member2',
  role              = 'member',
  card_balance      = 5,
  makeup_quota      = 0,
  member_valid_until = '2026-12-31',
  member_group_id   = 'e2e00000-0000-0000-0000-000000000001'
WHERE id = (SELECT id FROM auth.users WHERE email = 'e2e-member2@mediatek.com');

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
-- 4c. Multi-Card Course (cards_per_session=2, for refund-count e2e)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.courses (id, group_id, name, description, type, teacher, room,
                            start_time, end_time, capacity, cards_per_session,
                            enrollment_start_at, enrollment_end_at)
VALUES (
  'e2e00000-0000-0000-0000-000000000022',
  'e2e00000-0000-0000-0000-000000000010',
  'E2E Multi-Card Course',
  'E2E multi-card refund test course (cards_per_session=2)',
  'normal',
  'E2E Teacher',
  'E2E Room',
  '18:00',
  '19:30',
  20,
  2,
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
-- 5a3. Session for E2E Multi-Card Course (1 future session)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.course_sessions (id, course_id, session_date, session_number, is_cancelled)
VALUES
  ('e2e00000-0000-0000-0000-000000000037',
   'e2e00000-0000-0000-0000-000000000022',
   CURRENT_DATE + INTERVAL '10 days', 1, FALSE)
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
-- 4d. NTD Course  (pricing_mode=ntd, for course_fee order test)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.courses (id, group_id, name, description, type, teacher, room,
                            start_time, end_time, capacity, cards_per_session,
                            enrollment_start_at, enrollment_end_at, pricing_mode)
VALUES (
  'e2e00000-0000-0000-0000-000000000023',
  'e2e00000-0000-0000-0000-000000000010',
  'E2E NTD Course',
  'E2E course-fee payment test course (pricing_mode=ntd)',
  'normal',
  'E2E Teacher',
  'E2E Room',
  '17:00',
  '18:30',
  20,
  0,
  NOW() - INTERVAL '1 day',
  NOW() + INTERVAL '30 days',
  'ntd'
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
  enrollment_end_at   = EXCLUDED.enrollment_end_at,
  pricing_mode        = EXCLUDED.pricing_mode;

-- ────────────────────────────────────────────────────────────
-- 5a4. Sessions for E2E NTD Course (3 future sessions)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.course_sessions (id, course_id, session_date, session_number, is_cancelled)
VALUES
  ('e2e00000-0000-0000-0000-000000000038',
   'e2e00000-0000-0000-0000-000000000023',
   CURRENT_DATE + INTERVAL '9 days',  1, FALSE),
  ('e2e00000-0000-0000-0000-000000000039',
   'e2e00000-0000-0000-0000-000000000023',
   CURRENT_DATE + INTERVAL '16 days', 2, FALSE),
  ('e2e00000-0000-0000-0000-00000000003a',
   'e2e00000-0000-0000-0000-000000000023',
   CURRENT_DATE + INTERVAL '23 days', 3, FALSE)
ON CONFLICT (id) DO UPDATE SET
  course_id      = EXCLUDED.course_id,
  session_date   = EXCLUDED.session_date,
  session_number = EXCLUDED.session_number,
  is_cancelled   = EXCLUDED.is_cancelled;

-- ────────────────────────────────────────────────────────────
-- 4e. Workshop Course  (type=workshop, for transfer e2e)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.courses (id, group_id, name, description, type, teacher, room,
                            start_time, end_time, capacity, cards_per_session,
                            enrollment_start_at, enrollment_end_at)
VALUES (
  'e2e00000-0000-0000-0000-000000000024',
  'e2e00000-0000-0000-0000-000000000010',
  'E2E Workshop',
  'E2E workshop transfer test course',
  'workshop',
  'E2E Teacher',
  'E2E Room',
  '21:00',
  '22:30',
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
-- 5a5. Sessions for E2E Workshop (4 future sessions)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.course_sessions (id, course_id, session_date, session_number, is_cancelled)
VALUES
  ('e2e00000-0000-0000-0000-00000000003b',
   'e2e00000-0000-0000-0000-000000000024',
   CURRENT_DATE + INTERVAL '3 days',  1, FALSE),
  ('e2e00000-0000-0000-0000-00000000003c',
   'e2e00000-0000-0000-0000-000000000024',
   CURRENT_DATE + INTERVAL '10 days', 2, FALSE),
  ('e2e00000-0000-0000-0000-00000000003d',
   'e2e00000-0000-0000-0000-000000000024',
   CURRENT_DATE + INTERVAL '17 days', 3, FALSE),
  ('e2e00000-0000-0000-0000-00000000003e',
   'e2e00000-0000-0000-0000-000000000024',
   CURRENT_DATE + INTERVAL '24 days', 4, FALSE)
ON CONFLICT (id) DO UPDATE SET
  course_id      = EXCLUDED.course_id,
  session_date   = EXCLUDED.session_date,
  session_number = EXCLUDED.session_number,
  is_cancelled   = EXCLUDED.is_cancelled;

-- ────────────────────────────────────────────────────────────
-- 9. Course Fee Order (pending/remitted, for review-center test)
--    E2E Member has a course_fee order with remittance info
-- ────────────────────────────────────────────────────────────
INSERT INTO public.orders (id, user_id, order_type, quantity, used, unit_price,
                           total_amount, amount, status, course_group_id,
                           remittance_bank_code, remittance_account_last5, remittance_date)
VALUES (
  'e2e00000-0000-0000-0000-000000000042',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'course_fee',
  1,
  0,
  0,
  0,
  800,
  'remitted',
  'e2e00000-0000-0000-0000-000000000010',
  '012',
  '54321',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  user_id              = EXCLUDED.user_id,
  order_type           = EXCLUDED.order_type,
  quantity             = EXCLUDED.quantity,
  used                 = EXCLUDED.used,
  unit_price           = EXCLUDED.unit_price,
  total_amount         = EXCLUDED.total_amount,
  amount               = EXCLUDED.amount,
  status               = EXCLUDED.status,
  course_group_id      = EXCLUDED.course_group_id,
  remittance_bank_code = EXCLUDED.remittance_bank_code,
  remittance_account_last5 = EXCLUDED.remittance_account_last5,
  remittance_date      = EXCLUDED.remittance_date;

-- ────────────────────────────────────────────────────────────
-- 10. Linked Enrollment (pending_payment, tied to the course_fee order)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.enrollments (id, course_id, user_id, status, type, session_id, source, order_id)
VALUES (
  'e2e00000-0000-0000-0000-000000000062',
  'e2e00000-0000-0000-0000-000000000023',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'pending_payment',
  'full',
  NULL,
  'self',
  'e2e00000-0000-0000-0000-000000000042'
)
ON CONFLICT (id) DO UPDATE SET
  course_id  = EXCLUDED.course_id,
  user_id    = EXCLUDED.user_id,
  status     = EXCLUDED.status,
  type       = EXCLUDED.type,
  session_id = EXCLUDED.session_id,
  source     = EXCLUDED.source,
  order_id   = EXCLUDED.order_id;

-- ────────────────────────────────────────────────────────────
-- 5c. Cleanup: remove non-seed enrollments, leave requests,
--     attendance records, card orders/transactions for idempotency
-- ────────────────────────────────────────────────────────────
-- Cleanup makeup_requests for e2e test courses (must precede attendance cleanup)
DELETE FROM public.makeup_requests
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND (original_course_id IN ('e2e00000-0000-0000-0000-000000000020',
                               'e2e00000-0000-0000-0000-000000000021',
                               'e2e00000-0000-0000-0000-000000000024')
    OR target_course_id IN ('e2e00000-0000-0000-0000-000000000020',
                             'e2e00000-0000-0000-0000-000000000021',
                             'e2e00000-0000-0000-0000-000000000024'));

-- Cleanup transfer_requests for e2e test courses
DELETE FROM public.transfer_requests
WHERE course_id IN ('e2e00000-0000-0000-0000-000000000020',
                     'e2e00000-0000-0000-0000-000000000021',
                     'e2e00000-0000-0000-0000-000000000024')
  AND (from_user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
    OR to_user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member2@mediatek.com'));

DELETE FROM public.leave_requests
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND session_id IN (SELECT id FROM public.course_sessions
                     WHERE course_id IN ('e2e00000-0000-0000-0000-000000000020',
                                         'e2e00000-0000-0000-0000-000000000021',
                                         'e2e00000-0000-0000-0000-000000000022',
                                         'e2e00000-0000-0000-0000-000000000023',
                                         'e2e00000-0000-0000-0000-000000000024'));

-- Cleanup attendance for member on all e2e courses (including workshop)
DELETE FROM public.attendance_records
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND session_id IN (SELECT id FROM public.course_sessions
                     WHERE course_id IN ('e2e00000-0000-0000-0000-000000000020',
                                         'e2e00000-0000-0000-0000-000000000021',
                                         'e2e00000-0000-0000-0000-000000000022',
                                         'e2e00000-0000-0000-0000-000000000023',
                                         'e2e00000-0000-0000-0000-000000000024'));

-- Cleanup attendance for member2 on all e2e courses
DELETE FROM public.attendance_records
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member2@mediatek.com')
  AND session_id IN (SELECT id FROM public.course_sessions
                     WHERE course_id IN ('e2e00000-0000-0000-0000-000000000020',
                                         'e2e00000-0000-0000-0000-000000000021',
                                         'e2e00000-0000-0000-0000-000000000024'));

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

-- Remove card transactions tied to the multi-card course enrollments (FK dep)
DELETE FROM public.card_transactions
WHERE enrollment_id IN (SELECT id FROM public.enrollments
                        WHERE course_id = 'e2e00000-0000-0000-0000-000000000022');

-- Remove non-seed enrollments for the multi-card course
DELETE FROM public.enrollments
WHERE course_id = 'e2e00000-0000-0000-0000-000000000022'
  AND id != 'e2e00000-0000-0000-0000-000000000061';

-- Remove enrollments for the NTD course that are not seeded
DELETE FROM public.enrollments
WHERE course_id = 'e2e00000-0000-0000-0000-000000000023'
  AND id != 'e2e00000-0000-0000-0000-000000000062';

-- Remove non-seed enrollments for the workshop course
DELETE FROM public.enrollments
WHERE course_id = 'e2e00000-0000-0000-0000-000000000024'
  AND id != 'e2e00000-0000-0000-0000-000000000063';

DELETE FROM public.orders
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND id NOT IN ('e2e00000-0000-0000-0000-000000000040', 'e2e00000-0000-0000-0000-000000000041', 'e2e00000-0000-0000-0000-000000000042');

DELETE FROM public.card_transactions
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com')
  AND id NOT IN ('e2e00000-0000-0000-0000-000000000050', 'e2e00000-0000-0000-0000-000000000051');

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

-- ────────────────────────────────────────────────────────────
-- 8. Multi-Card Course: single enrollment + dedicated card order
--    The member has a single enrollment on the multi-card course
--    (cards_per_session=2), with 2 cards deducted from a separate order.
-- ────────────────────────────────────────────────────────────
INSERT INTO public.orders (id, user_id, quantity, used, unit_price, total_amount,
                                 status, expires_at, confirmed_at, confirmed_by, order_type)
VALUES (
  'e2e00000-0000-0000-0000-000000000041',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  2,
  2,
  270,
  540,
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

INSERT INTO public.card_transactions (id, user_id, type, amount, balance_after,
                                       order_id, note, created_by)
VALUES (
  'e2e00000-0000-0000-0000-000000000051',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'purchase',
  2,
  12,
  'e2e00000-0000-0000-0000-000000000041',
  'E2E seed: 2 cards for multi-card course',
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

INSERT INTO public.enrollments (id, course_id, user_id, status, type, session_id, source)
VALUES (
  'e2e00000-0000-0000-0000-000000000061',
  'e2e00000-0000-0000-0000-000000000022',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'enrolled',
  'single',
  'e2e00000-0000-0000-0000-000000000037',
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
-- 11. Workshop enrollment (member full-enrolled for transfer tests)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.enrollments (id, course_id, user_id, status, type, session_id, source)
VALUES (
  'e2e00000-0000-0000-0000-000000000063',
  'e2e00000-0000-0000-0000-000000000024',
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
-- 12. Absence on past session of E2E Basic Groove (makeup source)
--     session 30 is the past session (CURRENT_DATE - 7 days)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.attendance_records (session_id, user_id, status, marked_by, marked_at)
VALUES (
  'e2e00000-0000-0000-0000-000000000030',
  (SELECT id FROM auth.users WHERE email = 'e2e-member@mediatek.com'),
  'absent',
  (SELECT id FROM auth.users WHERE email = 'e2e-admin@mediatek.com'),
  NOW()
)
ON CONFLICT (session_id, user_id) DO UPDATE SET
  status    = EXCLUDED.status,
  marked_by = EXCLUDED.marked_by,
  marked_at = EXCLUDED.marked_at;

-- ============================================================
-- Done. Verify with:
--   SELECT name, role, card_balance FROM profiles
--   WHERE id IN (SELECT id FROM auth.users
--                WHERE email LIKE 'e2e-%@mediatek.com');
-- ============================================================
