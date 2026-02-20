-- ============================================================
-- Migration 005: Precise & Secure RLS for Profiles & Enrollments
-- ============================================================

-- 0. Remove phone column as requested
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;

-- 1. 重新啟動 RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

-- 2. 移除舊策略
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admin can manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

-- 3. 【Profiles】設定：所有登入者都能看到 Profile (姓名與角色) 以利點名單運作
-- 使用 TO authenticated 確保只有登入的人能看
CREATE POLICY "Profiles are viewable by authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- 4. 【Profiles】修改權限：只有本人或 Admin 可以修改
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  auth.uid() = id 
  OR 
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 5. 【Enrollments】設定：所有登入者都能看到報名名單 (為了點名單表格)
DROP POLICY IF EXISTS "Authenticated users can view enrollments" ON public.enrollments;
CREATE POLICY "Authenticated users can view enrollments"
ON public.enrollments FOR SELECT
TO authenticated
USING (true);

-- 6. 【Enrollments】修改權限：只有本人能報名，Admin 能管理
DROP POLICY IF EXISTS "Users can manage own enrollments" ON public.enrollments;
CREATE POLICY "Users can manage own enrollments"
ON public.enrollments FOR ALL
TO authenticated
USING (
  user_id = auth.uid() 
  OR 
  (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
);

-- 7. 【檔期/課程】權限
DROP POLICY IF EXISTS "Public can view course_groups" ON public.course_groups;
CREATE POLICY "Public can view course_groups" ON public.course_groups FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view published courses" ON public.courses;
CREATE POLICY "Public can view published courses" ON public.courses FOR SELECT 
USING (
  status = 'published' 
  OR 
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'leader')
);
