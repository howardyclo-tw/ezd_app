-- 014_resubmit_void.sql
-- Atomic void of a member's full-term group submission (作廢重報).
--
-- Cancels active enrollments, refunds deducted cards, cancels linked orders.
-- Refuses if any linked order is already confirmed (paid).
-- Idempotent: FOR UPDATE + conditional status checks prevent double-cancel/double-refund
-- under concurrent calls.

CREATE OR REPLACE FUNCTION void_group_submission(
  p_user     uuid,
  p_group_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_course_ids      uuid[];
  v_enrollment       record;
  v_voided_count    int := 0;
  v_total_refund    int := 0;
  v_order_ids       uuid[];
  v_has_confirmed   boolean;
  v_remaining       int;
  v_pool            record;
  v_to_refund       int;
  v_new_balance     int;
  v_today           date;
BEGIN
  -- ================================================================
  -- 1. Collect course IDs belonging to this group
  -- ================================================================
  SELECT array_agg(id) INTO v_course_ids
  FROM courses
  WHERE group_id = p_group_id;

  IF v_course_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_courses_in_group');
  END IF;

  -- ================================================================
  -- 2. Early exit: no active full enrollment to void
  -- ================================================================
  IF NOT EXISTS (
    SELECT 1 FROM enrollments
    WHERE user_id = p_user
      AND course_id = ANY(v_course_ids)
      AND type = 'full'
      AND status IN ('enrolled', 'pending_payment', 'pending_vote')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_active_submission');
  END IF;

  -- ================================================================
  -- 3. Collect linked order IDs from active enrollments
  -- ================================================================
  SELECT array_agg(DISTINCT e.order_id) INTO v_order_ids
  FROM enrollments e
  WHERE e.user_id = p_user
    AND e.course_id = ANY(v_course_ids)
    AND e.type = 'full'
    AND e.status IN ('enrolled', 'pending_payment', 'pending_vote')
    AND e.order_id IS NOT NULL;

  -- ================================================================
  -- 4. CONFIRMED-ORDER REFUSAL — block the entire operation
  -- ================================================================
  IF v_order_ids IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM orders WHERE id = ANY(v_order_ids) AND status = 'confirmed'
    ) INTO v_has_confirmed;

    IF v_has_confirmed THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'confirmed_order');
    END IF;
  END IF;

  -- ================================================================
  -- 5. Cancel enrollments with FOR UPDATE lock
  --    Captures old_status so we know which had card deductions.
  --    The conditional UPDATE (WHERE status IN active) makes this
  --    idempotent: a concurrent call that acquires the lock after us
  --    will see status=cancelled and the WHERE won't match.
  -- ================================================================
  FOR v_enrollment IN
    SELECT e.id, e.status AS old_status, c.cards_per_session, c.pricing_mode,
           (SELECT COUNT(*) FROM course_sessions cs
            WHERE cs.course_id = e.course_id) AS session_count
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = p_user
      AND e.course_id = ANY(v_course_ids)
      AND e.type = 'full'
      AND e.status IN ('enrolled', 'pending_payment', 'pending_vote')
    FOR UPDATE OF e
  LOOP
    UPDATE enrollments
    SET status = 'cancelled',
        cancelled_at = NOW(),
        cancel_reason = '作廢重報'
    WHERE id = v_enrollment.id
      AND status IN ('enrolled', 'pending_payment', 'pending_vote');

    IF FOUND THEN
      v_voided_count := v_voided_count + 1;

      -- Only enrolled card courses had FIFO card deductions
      IF v_enrollment.old_status = 'enrolled'
         AND v_enrollment.pricing_mode = 'card'
         AND v_enrollment.cards_per_session > 0 THEN
        v_total_refund := v_total_refund
          + (v_enrollment.cards_per_session * v_enrollment.session_count);
      END IF;
    END IF;
  END LOOP;

  IF v_voided_count = 0 THEN
    -- All were already cancelled by a concurrent call
    RETURN jsonb_build_object('ok', true, 'voided', 0, 'refunded_cards', 0);
  END IF;

  -- ================================================================
  -- 6. Cancel linked orders (pending / remitted -> cancelled)
  -- ================================================================
  IF v_order_ids IS NOT NULL THEN
    UPDATE orders
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = ANY(v_order_ids)
      AND status IN ('pending', 'remitted');
  END IF;

  -- ================================================================
  -- 7. Refund cards — restore orders.used earliest-expiry first
  -- ================================================================
  IF v_total_refund > 0 THEN
    v_today := (NOW() AT TIME ZONE 'Asia/Taipei')::date;
    v_remaining := v_total_refund;

    FOR v_pool IN
      SELECT id, used
      FROM orders
      WHERE user_id = p_user
        AND status = 'confirmed'
        AND order_type = 'card_purchase'
        AND used > 0
      ORDER BY expires_at ASC NULLS LAST, created_at ASC
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_to_refund := LEAST(v_pool.used, v_remaining);
      UPDATE orders SET used = used - v_to_refund WHERE id = v_pool.id;
      v_remaining := v_remaining - v_to_refund;
    END LOOP;

    -- Recalculate balance (unexpired as of today)
    SELECT COALESCE(SUM(quantity - used), 0) INTO v_new_balance
    FROM orders
    WHERE user_id = p_user
      AND status = 'confirmed'
      AND order_type = 'card_purchase'
      AND (quantity - used) > 0
      AND (expires_at IS NULL OR expires_at >= v_today);

    UPDATE profiles SET card_balance = v_new_balance WHERE id = p_user;

    -- Record refund transaction
    INSERT INTO card_transactions (user_id, type, amount, balance_after, note)
    VALUES (p_user, 'refund', v_total_refund, v_new_balance, '作廢重報退還堂卡');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'voided', v_voided_count,
    'refunded_cards', v_total_refund
  );
END;
$$;
