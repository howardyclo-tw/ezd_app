-- ============================================================
-- Migration 004: Create 25 Fun Test Users for Attendance UI
-- ============================================================

-- Function to create a user in auth.users and bypass email verification
CREATE OR REPLACE FUNCTION public.create_test_user(u_email TEXT, u_password TEXT, u_name TEXT)
RETURNS UUID AS $$
DECLARE
  new_user_id UUID;
BEGIN
  -- Insert into auth.users (Supabase internal table)
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    u_email,
    crypt(u_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    format('{"name":"%s"}', u_name)::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO new_user_id;

  -- Ensure the profile is created
  INSERT INTO public.profiles (id, name, role)
  VALUES (new_user_id, u_name, 'member')
  ON CONFLICT (id) DO UPDATE SET name = u_name;

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql;

-- 1. Create 25 Fun Test Students (Short names only, max 3 chars)
DO $$
DECLARE
  sid UUID;
  cid UUID;
  names TEXT[] := ARRAY[
    '周杰倫', '蔡依林', '林俊傑', '張惠妹', '陳奕迅',
    '魯夫', '索隆', '娜美', '羅志祥', '喬巴',
    '鳴人', '佐助', '小櫻', '卡卡西', '雛田',
    '炭治郎', '禰豆子', '善逸', '伊之助', '義勇',
    '安妮亞', '黃昏', '約兒', '五條悟', '伏黑惠'
  ];
  i INTEGER;
BEGIN
  -- Get the Course ID for 'locking-basic'
  SELECT id INTO cid FROM public.courses WHERE slug = 'locking-basic' LIMIT 1;

  FOR i IN 1..25 LOOP
    sid := public.create_test_user(
      format('user%s@test.ezd.app', i), 
      'test', 
      names[i]
    );

    -- 2. Enroll all of them in Locking Basic to test a full class
    IF cid IS NOT NULL THEN
      INSERT INTO public.enrollments (course_id, user_id, status) 
      VALUES (cid, sid, 'enrolled');
    END IF;
  END LOOP;
END $$;
