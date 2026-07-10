-- Migration 016: RLS hardening — drop client write policies, keep SELECT-only
-- All writes now go through service-role (createAdminClient) in server actions.
-- This closes 3 security holes:
--   1. profiles: self-escalation to admin via UPDATE policy
--   2. enrollments: direct writes bypassing all server guards
--   3. orders: pending/remitted amount tampering via UPDATE policy

BEGIN;

-- ============================================================
-- PROFILES: keep SELECT + INSERT (auth signup needs it), drop UPDATE
-- ============================================================
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- ============================================================
-- ENROLLMENTS: keep SELECT, drop ALL (write) policy
-- ============================================================
DROP POLICY IF EXISTS "Users can manage enrollments" ON enrollments;

-- ============================================================
-- ORDERS: keep SELECT, drop INSERT + UPDATE + ALL (admin)
-- ============================================================
DROP POLICY IF EXISTS "Users can create orders" ON orders;
DROP POLICY IF EXISTS "Users can update pending orders" ON orders;
DROP POLICY IF EXISTS "Admin can manage orders" ON orders;

-- Re-create admin SELECT on orders (the ALL policy we dropped also covered SELECT)
CREATE POLICY "Admin can view all orders" ON orders
  FOR SELECT TO authenticated
  USING (is_admin());

-- ============================================================
-- REVOKE EXECUTE on sensitive RPCs from anon + authenticated
-- These are only called by service-role via server actions.
-- ============================================================
REVOKE EXECUTE ON FUNCTION enroll_atomic FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION void_group_submission FROM anon, authenticated;

-- Note: is_admin() is used in remaining SELECT policies, so keep EXECUTE for authenticated.
-- But revoke from anon:
REVOKE EXECUTE ON FUNCTION is_admin FROM anon;

COMMIT;
