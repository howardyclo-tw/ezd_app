-- Migration 018: Payment deadline — concert-ticket reservation model
-- Adds per-group deadline config + per-enrollment deadline tracking
-- Updates enroll_atomic with p_payment_deadline_at param
-- Updates promote_from_waitlist to compute deadline on NTD promotion

BEGIN;

-- 1. Schema additions
ALTER TABLE course_groups ADD COLUMN IF NOT EXISTS payment_deadline_days INTEGER;
COMMENT ON COLUMN course_groups.payment_deadline_days IS '報名後繳費期限（天數），NULL = 不設期限';

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_deadline_at TIMESTAMPTZ;
COMMENT ON COLUMN enrollments.payment_deadline_at IS '繳費截止時間，enrolled_at + deadline_days 計算';

-- 2. Drop old 8-param enroll_atomic, replace with 9-param version
DROP FUNCTION IF EXISTS public.enroll_atomic(uuid, uuid, text, uuid, text, integer, uuid, boolean);

CREATE OR REPLACE FUNCTION public.enroll_atomic(
  p_user uuid,
  p_course uuid,
  p_type text,
  p_session uuid DEFAULT NULL::uuid,
  p_status text DEFAULT 'enrolled'::text,
  p_cards_to_deduct integer DEFAULT 0,
  p_order_id uuid DEFAULT NULL::uuid,
  p_allow_waitlist boolean DEFAULT false,
  p_payment_deadline_at timestamptz DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  v_any_full         boolean;
  v_waitlist_pos     int;
BEGIN
  SELECT capacity INTO v_capacity
  FROM courses
  WHERE id = p_course
  FOR UPDATE;

  IF v_capacity IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'course_not_found');
  END IF;

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

  SELECT COUNT(*) INTO v_full_count
  FROM enrollments
  WHERE course_id = p_course
    AND type = 'full'
    AND status IN ('enrolled', 'pending_payment', 'pending_vote');

  IF p_type = 'full' THEN
    v_any_full := false;

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
        v_any_full := true;
        EXIT;
      END IF;
    END LOOP;

    IF v_any_full THEN
      IF p_allow_waitlist THEN
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_pos
        FROM enrollments WHERE course_id = p_course AND status = 'waitlist';

        IF v_existing_id IS NOT NULL THEN
          UPDATE enrollments SET
            status = 'waitlist', waitlist_position = v_waitlist_pos,
            cancelled_at = NULL, enrolled_at = NOW(), order_id = p_order_id,
            payment_deadline_at = NULL
          WHERE id = v_existing_id
          RETURNING id INTO v_enrollment_id;
        ELSE
          INSERT INTO enrollments
            (course_id, user_id, status, type, session_id, source, order_id, wants_leader, waitlist_position, payment_deadline_at)
          VALUES
            (p_course, p_user, 'waitlist', p_type, p_session, 'self', p_order_id, false, v_waitlist_pos, NULL)
          RETURNING id INTO v_enrollment_id;
        END IF;

        RETURN jsonb_build_object(
          'ok', true, 'enrollment_id', v_enrollment_id,
          'status', 'waitlist', 'waitlist_position', v_waitlist_pos
        );
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'full');
    END IF;

    SELECT MAX(session_date) INTO v_session_date
    FROM course_sessions WHERE course_id = p_course;

  ELSE
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
      IF p_allow_waitlist THEN
        SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_pos
        FROM enrollments WHERE course_id = p_course AND status = 'waitlist';

        IF v_existing_id IS NOT NULL THEN
          UPDATE enrollments SET
            status = 'waitlist', waitlist_position = v_waitlist_pos,
            cancelled_at = NULL, enrolled_at = NOW(), order_id = p_order_id,
            payment_deadline_at = NULL
          WHERE id = v_existing_id
          RETURNING id INTO v_enrollment_id;
        ELSE
          INSERT INTO enrollments
            (course_id, user_id, status, type, session_id, source, order_id, wants_leader, waitlist_position, payment_deadline_at)
          VALUES
            (p_course, p_user, 'waitlist', p_type, p_session, 'self', p_order_id, false, v_waitlist_pos, NULL)
          RETURNING id INTO v_enrollment_id;
        END IF;

        RETURN jsonb_build_object(
          'ok', true, 'enrollment_id', v_enrollment_id,
          'status', 'waitlist', 'waitlist_position', v_waitlist_pos
        );
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'full');
    END IF;
  END IF;

  -- Normal enrollment (capacity available)
  IF v_existing_id IS NOT NULL THEN
    UPDATE enrollments SET
      status = p_status, cancelled_at = NULL, enrolled_at = NOW(),
      order_id = p_order_id, source = 'self',
      payment_deadline_at = p_payment_deadline_at
    WHERE id = v_existing_id
    RETURNING id INTO v_enrollment_id;
  ELSE
    INSERT INTO enrollments
      (course_id, user_id, status, type, session_id, source, order_id, wants_leader, payment_deadline_at)
    VALUES
      (p_course, p_user, p_status, p_type, p_session, 'self', p_order_id, false, p_payment_deadline_at)
    RETURNING id INTO v_enrollment_id;
  END IF;

  -- Card deduction (unchanged from 017)
  IF p_cards_to_deduct > 0 THEN
    v_today := (NOW() AT TIME ZONE 'Asia/Taipei')::date;
    v_remaining := p_cards_to_deduct;

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
      RAISE EXCEPTION 'insufficient_cards';
    END IF;

    SELECT COALESCE(SUM(quantity - used), 0) INTO v_new_balance
    FROM orders
    WHERE user_id = p_user
      AND status = 'confirmed'
      AND order_type = 'card_purchase'
      AND (quantity - used) > 0
      AND (expires_at IS NULL OR expires_at >= v_today);

    UPDATE profiles SET card_balance = v_new_balance WHERE id = p_user;

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
    RAISE;
END;
$function$;

-- Restrict new enroll_atomic to service-role only
REVOKE EXECUTE ON FUNCTION public.enroll_atomic(uuid, uuid, text, uuid, text, integer, uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated;


-- 3. Update promote_from_waitlist to compute payment_deadline_at on NTD promotion
DROP FUNCTION IF EXISTS public.promote_from_waitlist(uuid, uuid);

CREATE OR REPLACE FUNCTION public.promote_from_waitlist(
  p_course_id UUID,
  p_session_id UUID DEFAULT NULL
)
 RETURNS JSONB
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_course         record;
  v_candidate      record;
  v_today          date;
  v_is_member      boolean;
  v_price          int;
  v_cards_needed   int;
  v_session_count  int;
  v_session_date   date;
  v_available      int;
  v_remaining      int;
  v_pool           record;
  v_to_deduct      int;
  v_new_balance    int;
  v_order_id       uuid;
  v_deadline_days  int;
  v_deadline_at    timestamptz;
BEGIN
  v_today := (NOW() AT TIME ZONE 'Asia/Taipei')::date;

  -- 1. Lock course row and get pricing info
  SELECT c.id, c.pricing_mode, c.cards_per_session, c.group_id,
         c.price_member_single, c.price_guest_single,
         c.price_member_full, c.price_guest_full
  INTO v_course
  FROM courses c
  WHERE c.id = p_course_id
  FOR UPDATE;

  IF v_course.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'course_not_found');
  END IF;

  -- Look up payment deadline from course group
  SELECT cg.payment_deadline_days INTO v_deadline_days
  FROM course_groups cg
  WHERE cg.id = v_course.group_id;

  v_deadline_at := CASE
    WHEN v_deadline_days IS NOT NULL THEN NOW() + (v_deadline_days || ' days')::interval
    ELSE NULL
  END;

  -- 2. Loop through waitlist candidates in order
  FOR v_candidate IN
    SELECT e.id, e.user_id, e.type, e.session_id
    FROM enrollments e
    WHERE e.course_id = p_course_id
      AND e.status = 'waitlist'
    ORDER BY e.waitlist_position ASC
    FOR UPDATE SKIP LOCKED
  LOOP

    -- ── FREE mode ──────────────────────────────────────────
    IF v_course.pricing_mode = 'free' THEN
      UPDATE enrollments
      SET status = 'enrolled', waitlist_position = NULL, enrolled_at = NOW(),
          payment_deadline_at = NULL
      WHERE id = v_candidate.id;

      RETURN jsonb_build_object(
        'ok', true, 'enrollment_id', v_candidate.id,
        'user_id', v_candidate.user_id, 'new_status', 'enrolled'
      );

    -- ── CARD mode ──────────────────────────────────────────
    ELSIF v_course.pricing_mode = 'card' THEN
      IF v_candidate.type = 'full' THEN
        SELECT COUNT(*) INTO v_session_count
        FROM course_sessions WHERE course_id = p_course_id;

        v_cards_needed := v_course.cards_per_session * v_session_count;

        SELECT MAX(session_date) INTO v_session_date
        FROM course_sessions WHERE course_id = p_course_id;
      ELSE
        v_cards_needed := v_course.cards_per_session;

        SELECT session_date INTO v_session_date
        FROM course_sessions WHERE id = v_candidate.session_id;
      END IF;

      SELECT COALESCE(SUM(quantity - used), 0) INTO v_available
      FROM orders
      WHERE user_id = v_candidate.user_id
        AND status = 'confirmed'
        AND order_type = 'card_purchase'
        AND (quantity - used) > 0
        AND (expires_at IS NULL OR expires_at >= v_session_date);

      IF v_available >= v_cards_needed THEN
        v_remaining := v_cards_needed;
        FOR v_pool IN
          SELECT id, quantity, used, expires_at
          FROM orders
          WHERE user_id = v_candidate.user_id
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

        SELECT COALESCE(SUM(quantity - used), 0) INTO v_new_balance
        FROM orders
        WHERE user_id = v_candidate.user_id
          AND status = 'confirmed'
          AND order_type = 'card_purchase'
          AND (quantity - used) > 0
          AND (expires_at IS NULL OR expires_at >= v_today);

        UPDATE profiles SET card_balance = v_new_balance
        WHERE id = v_candidate.user_id;

        UPDATE enrollments
        SET status = 'enrolled', waitlist_position = NULL, enrolled_at = NOW(),
            payment_deadline_at = NULL
        WHERE id = v_candidate.id;

        INSERT INTO card_transactions
          (user_id, type, amount, balance_after, enrollment_id, note)
        VALUES
          (v_candidate.user_id, 'deduct', -v_cards_needed, v_new_balance,
           v_candidate.id, '候補遞補扣除堂卡');

        RETURN jsonb_build_object(
          'ok', true, 'enrollment_id', v_candidate.id,
          'user_id', v_candidate.user_id, 'new_status', 'enrolled'
        );
      ELSE
        CONTINUE;
      END IF;

    -- ── NTD mode ───────────────────────────────────────────
    ELSIF v_course.pricing_mode = 'ntd' THEN
      SELECT EXISTS(
        SELECT 1 FROM profiles p
        LEFT JOIN member_groups mg ON p.member_group_id = mg.id
        WHERE p.id = v_candidate.user_id
          AND p.role IN ('member', 'admin')
          AND (mg.valid_until >= v_today OR p.member_valid_until >= v_today)
      ) INTO v_is_member;

      IF v_candidate.type = 'full' THEN
        v_price := CASE WHEN v_is_member
                        THEN v_course.price_member_full
                        ELSE v_course.price_guest_full END;
      ELSE
        v_price := CASE WHEN v_is_member
                        THEN v_course.price_member_single
                        ELSE v_course.price_guest_single END;
      END IF;

      IF COALESCE(v_price, 0) = 0 THEN
        UPDATE enrollments
        SET status = 'enrolled', waitlist_position = NULL, enrolled_at = NOW(),
            payment_deadline_at = NULL
        WHERE id = v_candidate.id;

        RETURN jsonb_build_object(
          'ok', true, 'enrollment_id', v_candidate.id,
          'user_id', v_candidate.user_id, 'new_status', 'enrolled'
        );
      ELSE
        INSERT INTO orders
          (id, user_id, order_type, amount, quantity, used, unit_price,
           total_amount, status, course_group_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), v_candidate.user_id, 'course_fee', v_price,
           1, 0, v_price, v_price, 'pending', v_course.group_id, NOW(), NOW())
        RETURNING id INTO v_order_id;

        UPDATE enrollments
        SET status = 'pending_payment', waitlist_position = NULL,
            enrolled_at = NOW(), order_id = v_order_id,
            payment_deadline_at = v_deadline_at
        WHERE id = v_candidate.id;

        RETURN jsonb_build_object(
          'ok', true, 'enrollment_id', v_candidate.id,
          'user_id', v_candidate.user_id, 'new_status', 'pending_payment',
          'order_id', v_order_id
        );
      END IF;

    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', false, 'reason', 'no_eligible_waitlist');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.promote_from_waitlist(UUID, UUID) FROM PUBLIC, anon, authenticated;

COMMIT;
