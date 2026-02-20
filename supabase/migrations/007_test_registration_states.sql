-- ============================================================
-- EZD App - Updated Seed Data (Multiple Groups + Priority Registration)
-- Adds various course groups with different registration states
-- ============================================================

-- 1. Course Groups with Different Registration States (Using UPSERT logic)
INSERT INTO public.course_groups (id, title, description, region, period_start, period_end, registration_phase1_start, registration_phase1_end) VALUES
  -- 狀態 A: 整期報名進行中 (一般常態)
  ('a0000001-0000-0000-0000-000000000002', 
   'HQ 2026 H1 常態課程', 
   '長期的進階訓練課程。', 
   'HQ', '2026-03-01', '2026-06-30',
   NOW() - INTERVAL '2 days', NOW() + INTERVAL '5 days'),

  -- 狀態 B: 整期報名已結束 (過期)
  ('a0000001-0000-0000-0000-000000000003', 
   'HQ 2026 1~2月 風格體驗', 
   '寒假專攻班紀錄。', 
   'HQ', '2026-01-01', '2026-02-28',
   '2026-01-01 00:00:00+08', '2026-02-15 23:59:59+08'),

  -- 狀態 C: 尚未開放報名 (未來)
  ('a0000001-0000-0000-0000-000000000004', 
   'HQ 2026暑期 密集班', 
   '即將於六月開放報名。', 
   'HQ', '2026-07-01', '2026-08-31',
   NOW() + INTERVAL '30 days', NOW() + INTERVAL '45 days'),

  -- 狀態 D: 無整期報名時段 (直接單堂)
  ('a0000001-0000-0000-0000-000000000001', 
   'HQ 2026 3月 單堂試跳', 
   '適合新手的基礎體驗。', 
   'HQ', '2026-03-01', '2026-03-31',
   NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  region = EXCLUDED.region,
  period_start = EXCLUDED.period_start,
  period_end = EXCLUDED.period_end,
  registration_phase1_start = EXCLUDED.registration_phase1_start,
  registration_phase1_end = EXCLUDED.registration_phase1_end,
  updated_at = NOW();
