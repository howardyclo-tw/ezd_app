-- 013_enroll_atomic.sql
-- Atomic enrollment RPC: row-lock + in-txn capacity recheck + FIFO card deduction
-- Prevents overselling under concurrent enrollment requests.
--
-- Occupancy formula matches src/lib/supabase/capacity.ts computeSessionOccupancy:
--   occupancy = activeFullCount + activeSingleCount(session)
--             + makeupCount + transferInCount
--             - leaveCount - transferOutCount
--
-- Active statuses: enrolled | pending_payment | pending_vote

CREATE OR REPLACE FUNCTION enroll_atomic(
  p_user        uuid,
  p_course      uuid,
  p_type        text,                    -- 'full' | 'single'
  p_session     uuid    DEFAULT NULL,    -- required for single; NULL for full
  p_status      text    DEFAULT 'enrolled',
  p_cards_to_deduct int DEFAULT 0,
  p_order_id    uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_capacity         int;
  v_enrollment_id    uuid;
  v_session_date     date;
  v_today            date;
  v_remaining        int;
  v_pool             record;
  v_to_deduct        int;
  v_new_balance      int;
  v_full_count       int;
  v_sess             record;
  v_single_count     int;
  v_makeup_count     int;
  v_transfer_in_count  int;
  v_leave_count      int;
  v_transfer_out_count int;
  v_occupancy        int;
  v_existing_id      uuid;
  v_existing_status  text;
BEGIN
  -- ================================================================
  -- 1. Lock the course row to serialize concurrent enrollers
  -- ================================================================
  SELECT capacity INTO v_capacity
  FROM courses
  WHERE id = p_course
  FOR UPDATE;

  IF v_capacity IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'course_not_found');
  END IF;

  -- ================================================================
  -- 2. Check for existing enrollment (prevent duplicates)
  -- ================================================================
  IF p_type = 'full' THEN
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM enrollments
    WHERE course_id = p_course AND user_id = p_user AND type = 'full'
    LIMIT 1;
  ELSE
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM enrollments
    WHERE course_id = p_course AND user_id = p_user AND session_id = p_session
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL
     AND v_existing_status IN ('enrolled', 'pending_payment', 'pending_vote', 'waitlist') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_enrolled');
  END IF;

  -- ================================================================
  -- 3. Count active full enrollments (same for all sessions)
  -- ================================================================
  SELECT COUNT(*) INTO v_full_count
  FROM enrollments
  WHERE course_id = p_course
    AND type = 'full'
    AND status IN ('enrolled', 'pending_payment', 'pending_vote');

  -- ================================================================
  -- 4. Capacity check (matches computeSessionOccupancy semantics)
  -- ================================================================
  IF p_type = 'full' THEN
    -- Full enrollment: the user occupies a seat in EVERY session,
    -- so check ALL sessions for available capacity.
    FOR v_sess IN
      SELECT id, session_date FROM course_sessions WHERE course_id = p_course
    LOOP
      SELECT COUNT(*) INTO v_single_count
      FROM enrollments
      WHERE course_id = p_course AND type = 'single'
        AND session_id = v_sess.id
        AND status IN ('enrolled', 'pending_payment', 'pending_vote');

      SELECT COUNT(*) INTO v_makeup_count
      FROM makeup_requests
      WHERE target_course_id = p_course AND target_session_id = v_sess.id
        AND status = 'approved';

      SELECT COUNT(*) INTO v_leave_count
      FROM leave_requests
      WHERE course_id = p_course AND session_id = v_sess.id
        AND status = 'approved';

      SELECT
        COUNT(*) FILTER (WHERE to_user_id IS NOT NULL),
        COUNT(*)
      INTO v_transfer_in_count, v_transfer_out_count
      FROM transfer_requests
      WHERE course_id = p_course AND session_id = v_sess.id
        AND status = 'approved';

      v_occupancy := v_full_count + v_single_count + v_makeup_count
                   + v_transfer_in_count - v_leave_count - v_transfer_out_count;

      IF v_occupancy >= v_capacity THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'full');
      END IF;
    END LOOP;

    -- Use latest session date for FIFO expiry check
    SELECT MAX(session_date) INTO v_session_date
    FROM course_sessions WHERE course_id = p_course;

  ELSE
    -- Single enrollment: check only the target session
    SELECT session_date INTO v_session_date
    FROM course_sessions WHERE id = p_session AND course_id = p_course;

    IF v_session_date IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
    END IF;

    SELECT COUNT(*) INTO v_single_count
    FROM enrollments
    WHERE course_id = p_course AND type = 'single'
      AND session_id = p_session
      AND status IN ('enrolled', 'pending_payment', 'pending_vote');

    SELECT COUNT(*) INTO v_makeup_count
    FROM makeup_requests
    WHERE target_course_id = p_course AND target_session_id = p_session
      AND status = 'approved';

    SELECT COUNT(*) INTO v_leave_count
    FROM leave_requests
    WHERE course_id = p_course AND session_id = p_session
      AND status = 'approved';

    SELECT
      COUNT(*) FILTER (WHERE to_user_id IS NOT NULL),
      COUNT(*)
    INTO v_transfer_in_count, v_transfer_out_count
    FROM transfer_requests
    WHERE course_id = p_course AND session_id = p_session
      AND status = 'approved';

    v_occupancy := v_full_count + v_single_count + v_makeup_count
                 + v_transfer_in_count - v_leave_count - v_transfer_out_count;

    IF v_occupancy >= v_capacity THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'full');
    END IF;
  END IF;

  -- ================================================================
  -- 5. Insert or reactivate enrollment
  -- ================================================================
  IF v_existing_id IS NOT NULL THEN
    -- Reactivate a cancelled enrollment
    UPDATE enrollments SET
      status = p_status, cancelled_at = NULL, enrolled_at = NOW(),
      order_id = p_order_id, source = 'self'
    WHERE id = v_existing_id
    RETURNING id INTO v_enrollment_id;
  ELSE
    INSERT INTO enrollments
      (course_id, user_id, status, type, session_id, source, order_id, wants_leader)
    VALUES
      (p_course, p_user, p_status, p_type, p_session, 'self', p_order_id, false)
    RETURNING id INTO v_enrollment_id;
  END IF;

  -- ================================================================
  -- 6. FIFO card deduction (mirrors card-utils.ts deductCardsFIFO)
  -- ================================================================
  IF p_cards_to_deduct > 0 THEN
    v_today := (NOW() AT TIME ZONE 'Asia/Taipei')::date;
    v_remaining := p_cards_to_deduct;

    -- Deduct from earliest-expiring pools first (FIFO), skipping
    -- pools that expire before the session date.
    FOR v_pool IN
      SELECT id, quantity, used, expires_at
      FROM orders
      WHERE user_id = p_user
        AND status = 'confirmed'
        AND order_type = 'card_purchase'
        AND (quantity - used) > 0
        AND (expires_at IS NULL OR expires_at >= v_session_date)
      ORDER BY expires_at ASC NULLS LAST, created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_to_deduct := LEAST(v_pool.quantity - v_pool.used, v_remaining);
      UPDATE orders SET used = used + v_to_deduct WHERE id = v_pool.id;
      v_remaining := v_remaining - v_to_deduct;
    END LOOP;

    IF v_remaining > 0 THEN
      -- Insufficient cards: RAISE rolls back enrollment + card updates
      RAISE EXCEPTION 'insufficient_cards';
    END IF;

    -- Recalculate balance (unexpired as of today)
    SELECT COALESCE(SUM(quantity - used), 0) INTO v_new_balance
    FROM orders
    WHERE user_id = p_user
      AND status = 'confirmed'
      AND order_type = 'card_purchase'
      AND (quantity - used) > 0
      AND (expires_at IS NULL OR expires_at >= v_today);

    -- Sync profiles.card_balance
    UPDATE profiles SET card_balance = v_new_balance WHERE id = p_user;

    -- Record card transaction
    INSERT INTO card_transactions (user_id, type, amount, balance_after, enrollment_id, note)
    VALUES (p_user, 'deduct', -p_cards_to_deduct, v_new_balance, v_enrollment_id,
            '報名課程扣除堂卡');
  END IF;

  RETURN jsonb_build_object('ok', true, 'enrollment_id', v_enrollment_id);

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_enrolled');
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'insufficient_cards%' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_cards');
    END IF;
    RAISE;  -- re-raise unexpected errors
END;
$$;
