-- SQL Seed Data for Testing Makeup Quota
-- Run this in the Supabase SQL Editor

DO $$
DECLARE
    v_user_id UUID := (SELECT id FROM auth.users LIMIT 1); -- Or replace with your specific user ID
    v_course_id UUID;
    v_session1_id UUID;
    v_session2_id UUID;
BEGIN
    -- 1. Ensure user has enough card balance
    UPDATE public.profiles SET card_balance = card_balance + 20 WHERE id = v_user_id;

    -- 2. Find a course and its sessions
    SELECT id INTO v_course_id FROM public.courses LIMIT 1;
    
    -- Pick two sessions
    SELECT id INTO v_session1_id FROM public.course_sessions WHERE course_id = v_course_id ORDER BY session_number LIMIT 1;
    SELECT id INTO v_session2_id FROM public.course_sessions WHERE course_id = v_course_id ORDER BY session_number LIMIT 1 OFFSET 1;

    -- 3. Insert 'absent' and 'leave' attendance records to create makeup quota
    INSERT INTO public.attendance_records (user_id, session_id, status, marked_by)
    VALUES 
        (v_user_id, v_session1_id, 'absent', v_user_id),
        (v_user_id, v_session2_id, 'leave', v_user_id)
    ON CONFLICT (user_id, session_id) DO UPDATE SET status = EXCLUDED.status;

    RAISE NOTICE 'Seed data inserted for user %', v_user_id;
END $$;
