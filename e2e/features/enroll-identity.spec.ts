import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Per-course identity-eligibility (enroll_full/single_identity)
 *
 * Tests:
 *   H1: Guest full-enrolls card course with identity='all' (succeeds)
 *   H2: Guest full-enrolls NTD course with identity='all' (succeeds, guest_full price)
 *   A1: member-only full course rejects guest (submitGroupEnrollment)
 *   A2: member-only single course rejects guest (batchEnrollInSessions)
 *   A3: NTD course with null guest_full price rejects guest
 *
 * All assertions hit the REAL server action via the e2e-test-actions API route
 * and verify both the action result AND the DB state.
 *
 * Seed fixtures (e2e/global-setup.ts):
 *   - IDS.identCardCourse:       card, enroll_full_identity='all'
 *   - IDS.identNtdCourse:        ntd, identity='all', guest_full=1200
 *   - IDS.identMemberOnlyFull:   card, enroll_full_identity='member'
 *   - IDS.identMemberOnlySingle: card, enroll_single_identity='member'
 *   - IDS.identNtdNoGuestPrice:  ntd, identity='all', price_guest_full=null
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';

// IDs from global-setup.ts (Phase 5R.1)
const IDENT_GROUP_ID           = 'e2e00000-0000-0000-0000-000000000014';
const IDENT_CARD_COURSE        = 'e2e00000-0000-0000-0000-0000000001a1';
const IDENT_NTD_COURSE         = 'e2e00000-0000-0000-0000-0000000001a2';
const IDENT_MEMBER_ONLY_FULL   = 'e2e00000-0000-0000-0000-0000000001a3';
const IDENT_MEMBER_ONLY_SINGLE = 'e2e00000-0000-0000-0000-0000000001a4';
const IDENT_NTD_NO_GUEST_PRICE = 'e2e00000-0000-0000-0000-0000000001a5';
const IDENT_MEMBER_SINGLE_SESSION = 'e2e00000-0000-0000-0000-0000000001b7';

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

/** Query enrollments for a user+course via Supabase REST (admin). */
async function getEnrollments(
  page: import('@playwright/test').Page,
  userId: string,
  courseId: string
) {
  const { url, key } = getSupabaseEnv();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
  const resp = await page.request.get(
    `${url}/rest/v1/enrollments?user_id=eq.${userId}&course_id=eq.${courseId}&select=id,status,type`,
    { headers }
  );
  return resp.json();
}

/** Query orders for a user+course_group via Supabase REST (admin). */
async function getOrders(
  page: import('@playwright/test').Page,
  userId: string,
  courseGroupId: string
) {
  const { url, key } = getSupabaseEnv();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
  const resp = await page.request.get(
    `${url}/rest/v1/orders?user_id=eq.${userId}&course_group_id=eq.${courseGroupId}&select=id,amount,status,order_type`,
    { headers }
  );
  return resp.json();
}

/** Delete enrollment rows + linked card_transactions + orders for a user+course (cleanup helper). */
async function cleanupEnrollments(
  page: import('@playwright/test').Page,
  userId: string,
  courseId: string
) {
  const { url, key } = getSupabaseEnv();
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=minimal',
  };

  // Delete card_transactions linked to those enrollments first
  const enrollments = await getEnrollments(page, userId, courseId);
  if (Array.isArray(enrollments) && enrollments.length > 0) {
    for (const e of enrollments) {
      await page.request.delete(
        `${url}/rest/v1/card_transactions?enrollment_id=eq.${e.id}`,
        { headers }
      );
    }
  }

  await page.request.delete(
    `${url}/rest/v1/enrollments?user_id=eq.${userId}&course_id=eq.${courseId}`,
    { headers }
  );
}

/** Cleanup orders for user+courseGroup */
async function cleanupOrders(
  page: import('@playwright/test').Page,
  userId: string,
  courseGroupId: string
) {
  const { url, key } = getSupabaseEnv();
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=minimal',
  };
  await page.request.delete(
    `${url}/rest/v1/orders?user_id=eq.${userId}&course_group_id=eq.${courseGroupId}`,
    { headers }
  );
}

test.describe('Enroll Identity — per-course identity-eligibility guards', () => {
  let guestId: string;

  test.beforeAll(async () => {
    guestId = await getUserIdByEmail('e2e-guest@mediatek.com');
  });

  // ──────────────────────────────────────────────────────────────
  // H1: Guest full-enrolls card course with identity='all' (succeeds)
  // Validates decision #5: identity='all' does NOT block guests.
  // Guest has card_balance=0, so we send buyCards to avoid card-shortfall rejection.
  // ──────────────────────────────────────────────────────────────
  test('H1: guest full-enrolls card course with identity=all succeeds', async ({ page }) => {
    await loginAs(page, 'guest');

    // Cleanup any prior enrollment
    await cleanupEnrollments(page, guestId, IDENT_CARD_COURSE);
    await cleanupOrders(page, guestId, IDENT_GROUP_ID);

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'submitGroupEnrollment',
        groupId: IDENT_GROUP_ID,
        selections: [{ courseId: IDENT_CARD_COURSE }],
        buyCards: {
          quantity: 10,
          remittance: { bankCode: '012', last5: '99999', remittanceDate: new Date().toISOString() },
        },
      },
    });
    const result = await resp.json();

    expect(result.perCourse).toBeDefined();
    const courseResult = result.perCourse.find((pc: any) => pc.courseId === IDENT_CARD_COURSE);
    expect(courseResult).toBeDefined();
    // The course should NOT be rejected for identity reasons — it should be pending_payment
    expect(courseResult.status).toBe('pending_payment');

    // Verify enrollment row exists in DB
    const rows = await getEnrollments(page, guestId, IDENT_CARD_COURSE);
    const active = (rows || []).filter((r: any) => ['enrolled', 'pending_payment'].includes(r.status));
    expect(active.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await cleanupEnrollments(page, guestId, IDENT_CARD_COURSE);
    await cleanupOrders(page, guestId, IDENT_GROUP_ID);
  });

  // ──────────────────────────────────────────────────────────────
  // H2: Guest full-enrolls NTD course, uses guest_full price (1200)
  // ──────────────────────────────────────────────────────────────
  test('H2: guest full-enrolls NTD course uses guest_full price', async ({ page }) => {
    await loginAs(page, 'guest');

    // Cleanup
    await cleanupEnrollments(page, guestId, IDENT_NTD_COURSE);
    await cleanupOrders(page, guestId, IDENT_GROUP_ID);

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'submitGroupEnrollment',
        groupId: IDENT_GROUP_ID,
        selections: [{ courseId: IDENT_NTD_COURSE }],
      },
    });
    const result = await resp.json();

    expect(result.perCourse).toBeDefined();
    const courseResult = result.perCourse.find((pc: any) => pc.courseId === IDENT_NTD_COURSE);
    expect(courseResult).toBeDefined();
    expect(courseResult.status).toBe('pending_payment');

    // Verify enrollment row exists in DB with pending_payment status
    const rows = await getEnrollments(page, guestId, IDENT_NTD_COURSE);
    const pending = (rows || []).filter((r: any) => r.status === 'pending_payment');
    expect(pending.length).toBeGreaterThanOrEqual(1);

    // Verify order has correct amount (guest_full = 1200)
    const orders = await getOrders(page, guestId, IDENT_GROUP_ID);
    const courseFeeOrders = (orders || []).filter((o: any) => o.order_type === 'course_fee');
    expect(courseFeeOrders.length).toBeGreaterThanOrEqual(1);
    expect(courseFeeOrders[0].amount).toBe(1200);

    // Cleanup
    await cleanupEnrollments(page, guestId, IDENT_NTD_COURSE);
    await cleanupOrders(page, guestId, IDENT_GROUP_ID);
  });

  // ──────────────────────────────────────────────────────────────
  // A1: member-only course rejects guest full enrollment (server-direct)
  // ──────────────────────────────────────────────────────────────
  test('A1: member-only course rejects guest full enrollment', async ({ page }) => {
    await loginAs(page, 'guest');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'submitGroupEnrollment',
        groupId: IDENT_GROUP_ID,
        selections: [{ courseId: IDENT_MEMBER_ONLY_FULL }],
      },
    });
    const result = await resp.json();

    expect(result.perCourse).toBeDefined();
    const courseResult = result.perCourse.find((pc: any) => pc.courseId === IDENT_MEMBER_ONLY_FULL);
    expect(courseResult).toBeDefined();
    expect(courseResult.status).toBe('rejected');
    expect(courseResult.reason).toContain('此課程整期報名僅開放社員');

    // Verify NO enrollment row in DB
    const rows = await getEnrollments(page, guestId, IDENT_MEMBER_ONLY_FULL);
    const active = (rows || []).filter((r: any) =>
      ['enrolled', 'pending_payment', 'pending_vote'].includes(r.status)
    );
    expect(active.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // A2: member-only course rejects guest single enrollment (server-direct)
  // ──────────────────────────────────────────────────────────────
  test('A2: member-only course rejects guest single enrollment', async ({ page }) => {
    await loginAs(page, 'guest');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInSessions',
        courseId: IDENT_MEMBER_ONLY_SINGLE,
        sessionIds: [IDENT_MEMBER_SINGLE_SESSION],
      },
    });
    const result = await resp.json();

    expect(result.success).toBe(false);
    expect(result.message).toContain('此課程單堂報名僅開放社員');

    // Verify NO enrollment row in DB
    const rows = await getEnrollments(page, guestId, IDENT_MEMBER_ONLY_SINGLE);
    const active = (rows || []).filter((r: any) =>
      ['enrolled', 'pending_payment'].includes(r.status)
    );
    expect(active.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // A3: NTD course with null guest_full price rejects guest enrollment
  // ──────────────────────────────────────────────────────────────
  test('A3: NTD course with null guest_full price rejects guest', async ({ page }) => {
    await loginAs(page, 'guest');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'submitGroupEnrollment',
        groupId: IDENT_GROUP_ID,
        selections: [{ courseId: IDENT_NTD_NO_GUEST_PRICE }],
      },
    });
    const result = await resp.json();

    // Should fail — resolvePrice throws when price is null for guest
    // The error may come as a perCourse rejection or a top-level error
    if (result.perCourse) {
      const courseResult = result.perCourse.find((pc: any) => pc.courseId === IDENT_NTD_NO_GUEST_PRICE);
      expect(courseResult).toBeDefined();
      expect(courseResult.status).toBe('rejected');
    } else {
      // Top-level failure
      expect(result.success).toBe(false);
    }

    // Verify NO enrollment row in DB
    const rows = await getEnrollments(page, guestId, IDENT_NTD_NO_GUEST_PRICE);
    const active = (rows || []).filter((r: any) =>
      ['enrolled', 'pending_payment', 'pending_vote'].includes(r.status)
    );
    expect(active.length).toBe(0);
  });
});
