-- ============================================================
-- 熱舞社管理系統 (EZD App) - Database Schema
-- Migration 001: Full Schema
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: Update profiles table
-- Add card_balance and member_valid_until fields
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS card_balance INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS member_valid_until DATE;

-- ============================================================
-- STEP 2: Course Groups (課程檔期)
-- e.g. "HQ 2026 H1 常態課程"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.course_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  region TEXT NOT NULL DEFAULT 'HQ', -- HQ / 竹北 / etc.
  period_start DATE,
  period_end DATE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STEP 3: Courses (課程)
-- e.g. "基礎律動 Basic Groove" taught by A-May
-- ============================================================
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.course_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'normal',
    -- normal / trial / special / style / workshop / rehearsal / performance
  teacher TEXT NOT NULL,
  room TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INT NOT NULL DEFAULT 30,
  cards_per_session INT NOT NULL DEFAULT 1, -- how many cards deducted per session
  status TEXT NOT NULL DEFAULT 'draft',
    -- draft / published / closed
  enrollment_start_at TIMESTAMPTZ,
  enrollment_end_at TIMESTAMPTZ,
  wiki_url TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STEP 4: Course Sessions (每一堂)
-- Each course has N sessions (1 per week typically)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.course_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  session_number INT NOT NULL, -- 1, 2, 3, ...
  is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  cancel_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_sessions_course_id ON public.course_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_course_sessions_date ON public.course_sessions(session_date);

-- ============================================================
-- STEP 5: Course Leaders (班長指派, 多對多)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.course_leaders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_course_leaders_course_id ON public.course_leaders(course_id);
CREATE INDEX IF NOT EXISTS idx_course_leaders_user_id ON public.course_leaders(user_id);

-- ============================================================
-- STEP 6: Enrollments (報名)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'enrolled',
    -- enrolled / waitlist / cancelled
  waitlist_position INT, -- NULL if not on waitlist, 1-based if on waitlist
  source TEXT NOT NULL DEFAULT 'self',
    -- self / admin / card_purchase
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  UNIQUE(course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON public.enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON public.enrollments(user_id);

-- ============================================================
-- STEP 7: Attendance Records (出席紀錄)
-- Created per session per enrolled student when class runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unmarked',
    -- unmarked / present / absent / leave / makeup / transfer_in / transfer_out
  note TEXT,
  marked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_session_id ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON public.attendance_records(user_id);

-- ============================================================
-- STEP 8: Leave Requests (請假申請)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending / approved / rejected
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_course_id ON public.leave_requests(course_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id ON public.leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);

-- ============================================================
-- STEP 9: Makeup Requests (補課申請)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.makeup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The session the student missed (original)
  original_course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  original_session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE CASCADE,
  -- The session the student wants to attend for makeup
  target_course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  target_session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending / approved / rejected
  quota_used NUMERIC(4,2) NOT NULL DEFAULT 1, -- e.g. 0.5 for cross-zone conversion
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_makeup_requests_user_id ON public.makeup_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_makeup_requests_status ON public.makeup_requests(status);

-- ============================================================
-- STEP 10: Transfer Requests (轉讓申請)
-- Transfer a single session spot to another person
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.course_sessions(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL, -- null = not yet assigned
  to_user_name TEXT, -- for display if user not in system yet
  extra_cards_required INT NOT NULL DEFAULT 0, -- if non-member takes member's spot
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending / approved / rejected / cancelled
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_course_id ON public.transfer_requests(course_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_from_user ON public.transfer_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_status ON public.transfer_requests(status);

-- ============================================================
-- STEP 11: Card Orders (堂卡購買訂單)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.card_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price INT NOT NULL, -- price per card in NTD at time of purchase
  total_amount INT NOT NULL, -- quantity * unit_price
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending / remitted / confirmed / cancelled
  -- Payment verification
  remittance_account_last5 TEXT, -- last 5 digits of sender's bank account
  remittance_date DATE,
  remittance_note TEXT,
  -- Admin
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  expires_at DATE, -- cards expire at end of year
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_orders_user_id ON public.card_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_card_orders_status ON public.card_orders(status);

-- ============================================================
-- STEP 12: Card Transactions (堂卡異動明細)
-- The ledger. card_balance on profiles is derived from this.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
    -- purchase / deduct / refund / expire / admin_adjust
  amount INT NOT NULL, -- positive = add, negative = deduct
  balance_after INT NOT NULL, -- snapshot of balance after this transaction
  -- Optional references to source
  order_id UUID REFERENCES public.card_orders(id) ON DELETE SET NULL,
  enrollment_id UUID REFERENCES public.enrollments(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL, -- null = system
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_tx_user_id ON public.card_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_card_tx_type ON public.card_transactions(type);

-- ============================================================
-- STEP 13: System Config (系統設定)
-- Key-value store for admin-configurable settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default config values
INSERT INTO public.system_config (key, value, description) VALUES
  ('card_price_member',     '270',        '社員每堂卡單價 (NTD)'),
  ('card_price_non_member', '370',        '非社員每堂卡單價 (NTD)'),
  ('card_min_purchase',     '5',          '最小購買堂卡數量'),
  ('card_purchase_open',    'false',      '堂卡購買時段是否開放 (true/false)'),
  ('card_purchase_start',   '',           '購買開放日 (YYYY-MM-DD)'),
  ('card_purchase_end',     '',           '購買截止日 (YYYY-MM-DD)'),
  ('card_expire_month',     '12',         '堂卡到期月份 (1-12, 預設12月底)'),
  ('makeup_quota_numerator','1',          '補課額度分子 (ceil(堂數 * n / d))'),
  ('makeup_quota_denominator','4',        '補課額度分母')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- STEP 14: Row Level Security (RLS)
-- ============================================================

-- Enable RLS on all new tables
ALTER TABLE public.course_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_leaders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.makeup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper: check if current user is leader or admin
CREATE OR REPLACE FUNCTION public.is_leader_or_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'leader')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper: check if current user is leader of a specific course
CREATE OR REPLACE FUNCTION public.is_course_leader(p_course_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.course_leaders
    WHERE course_id = p_course_id AND user_id = auth.uid()
  ) OR public.is_admin();
$$ LANGUAGE sql SECURITY DEFINER;

-- ── course_groups ──
CREATE POLICY "Public can view published groups" ON public.course_groups
  FOR SELECT USING (TRUE); -- Group visibility controlled by child courses' status

CREATE POLICY "Admin can manage groups" ON public.course_groups
  FOR ALL USING (public.is_admin());

-- ── courses ──
CREATE POLICY "Anyone can view published courses" ON public.courses
  FOR SELECT USING (status = 'published' OR public.is_leader_or_admin());

CREATE POLICY "Admin can manage courses" ON public.courses
  FOR ALL USING (public.is_admin());

-- ── course_sessions ──
CREATE POLICY "Anyone can view sessions of published courses" ON public.course_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.courses
      WHERE id = course_sessions.course_id AND (status = 'published' OR public.is_leader_or_admin())
    )
  );

CREATE POLICY "Admin can manage sessions" ON public.course_sessions
  FOR ALL USING (public.is_admin());

-- ── course_leaders ──
CREATE POLICY "Anyone can view course leaders" ON public.course_leaders
  FOR SELECT USING (TRUE);

CREATE POLICY "Admin can manage course leaders" ON public.course_leaders
  FOR ALL USING (public.is_admin());

-- ── enrollments ──
CREATE POLICY "Users can view their own enrollments" ON public.enrollments
  FOR SELECT USING (user_id = auth.uid() OR public.is_leader_or_admin());

CREATE POLICY "Users can enroll themselves" ON public.enrollments
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can cancel their own enrollment" ON public.enrollments
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admin can manage all enrollments" ON public.enrollments
  FOR ALL USING (public.is_admin());

-- ── attendance_records ──
CREATE POLICY "Users can view their own attendance" ON public.attendance_records
  FOR SELECT USING (user_id = auth.uid() OR public.is_leader_or_admin());

CREATE POLICY "Leaders can mark attendance for their courses" ON public.attendance_records
  FOR ALL USING (
    public.is_course_leader(
      (SELECT course_id FROM public.course_sessions WHERE id = attendance_records.session_id)
    )
  );

-- ── leave_requests ──
CREATE POLICY "Users can view their own leave requests" ON public.leave_requests
  FOR SELECT USING (user_id = auth.uid() OR public.is_leader_or_admin());

CREATE POLICY "Users can submit leave requests" ON public.leave_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Leaders/admin can review leave requests" ON public.leave_requests
  FOR UPDATE USING (public.is_leader_or_admin());

-- ── makeup_requests ──
CREATE POLICY "Users can view their own makeup requests" ON public.makeup_requests
  FOR SELECT USING (user_id = auth.uid() OR public.is_leader_or_admin());

CREATE POLICY "Users can submit makeup requests" ON public.makeup_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Leaders/admin can review makeup requests" ON public.makeup_requests
  FOR UPDATE USING (public.is_leader_or_admin());

-- ── transfer_requests ──
CREATE POLICY "Users can view their own transfer requests" ON public.transfer_requests
  FOR SELECT USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR public.is_leader_or_admin());

CREATE POLICY "Users can submit transfer requests" ON public.transfer_requests
  FOR INSERT WITH CHECK (from_user_id = auth.uid());

CREATE POLICY "Leaders/admin can review transfer requests" ON public.transfer_requests
  FOR UPDATE USING (public.is_leader_or_admin());

-- ── card_orders ──
CREATE POLICY "Users can view their own orders" ON public.card_orders
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can create card orders" ON public.card_orders
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own pending orders" ON public.card_orders
  FOR UPDATE USING (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "Admin can manage all orders" ON public.card_orders
  FOR ALL USING (public.is_admin());

-- ── card_transactions ──
CREATE POLICY "Users can view their own transactions" ON public.card_transactions
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "System and admin can insert transactions" ON public.card_transactions
  FOR INSERT WITH CHECK (public.is_admin() OR auth.uid() IS NOT NULL);

-- ── system_config ──
CREATE POLICY "Anyone can read system config" ON public.system_config
  FOR SELECT USING (TRUE);

CREATE POLICY "Only admin can modify system config" ON public.system_config
  FOR ALL USING (public.is_admin());

-- ============================================================
-- STEP 15: Updated_at auto-update trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_course_groups
  BEFORE UPDATE ON public.course_groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_courses
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_card_orders
  BEFORE UPDATE ON public.card_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- DONE! Summary of created tables:
--   profiles         (modified: +card_balance, +member_valid_until)
--   course_groups    (新增: 課程檔期)
--   courses          (新增: 課程)
--   course_sessions  (新增: 每堂)
--   course_leaders   (新增: 班長指派)
--   enrollments      (新增: 報名)
--   attendance_records (新增: 出席紀錄)
--   leave_requests   (新增: 請假申請)
--   makeup_requests  (新增: 補課申請)
--   transfer_requests (新增: 轉讓申請)
--   card_orders      (新增: 堂卡購買訂單)
--   card_transactions (新增: 堂卡異動明細)
--   system_config    (新增: 系統設定)
-- ============================================================
