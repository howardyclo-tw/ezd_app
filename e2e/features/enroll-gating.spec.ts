import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Server-enforced enrollment gating
 *
 * Guards tested:
 *   1. pricing_mode guard — card-only enroll paths reject non-card courses
 *   2. enroll-mode guard — enroll_single=false / enroll_full=false
 *   3. Window guard (full) — group phase1 window
 *   4. Window guard (single) — course enrollment_start_at / end_at
 *
 * All assertions hit the REAL server action via the e2e-test-actions API route
 * and verify both the action result AND the absence/presence of enrollment rows.
 *
 * Seed fixtures (e2e/global-setup.ts):
 *   - IDS.singleCourse: card, enroll_single=true, open window — happy path single
 *   - IDS.course: card, enroll_full=true, open group phase1 — (member already full-enrolled)
 *   - IDS.noSingleCourse: card, enroll_single=false — adversarial (a)
 *   - IDS.closedWindowCourse: card, enrollment window in the past — adversarial (b)
 *   - IDS.closedPhase1Course: card, in closed-phase1 group — adversarial (c)
 *   - IDS.ntdCourse: pricing_mode=ntd — adversarial (d)
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';

// IDs from global-setup.ts
const SINGLE_COURSE_ID       = 'e2e00000-0000-0000-0000-000000000021';
const SINGLE_SESSION_1       = 'e2e00000-0000-0000-0000-000000000034';
const NO_SINGLE_COURSE_ID    = 'e2e00000-0000-0000-0000-000000000026';
const NO_SINGLE_SESSION      = 'e2e00000-0000-0000-0000-0000000000a1';
const CLOSED_WINDOW_COURSE   = 'e2e00000-0000-0000-0000-000000000027';
const CLOSED_WINDOW_SESSION  = 'e2e00000-0000-0000-0000-0000000000a2';
const CLOSED_PHASE1_COURSE   = 'e2e00000-0000-0000-0000-000000000028';
const NTD_COURSE_ID          = 'e2e00000-0000-0000-0000-000000000023';
const NTD_SESSION_1          = 'e2e00000-0000-0000-0000-000000000038';

// Use the no-single course for the happy full-enroll test (enroll_full=true, open group)
const HAPPY_FULL_COURSE_ID   = NO_SINGLE_COURSE_ID;

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

/** Delete enrollment rows for a user+course (cleanup helper). */
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

test.describe('Enroll Gating — server-enforced guards', () => {
  let memberId: string;

  test.beforeAll(async () => {
    memberId = await getUserIdByEmail('e2e-member@mediatek.com');
  });

  // ──────────────────────────────────────────────────────────────
  // HAPPY: in-window single enroll on an open card course succeeds
  // ──────────────────────────────────────────────────────────────
  test('HAPPY: single enroll on open card course succeeds', async ({ page }) => {
    await loginAs(page, 'member');

    // Cleanup any prior enrollment for this session
    await cleanupEnrollments(page, memberId, SINGLE_COURSE_ID);

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInSessions',
        courseId: SINGLE_COURSE_ID,
        sessionIds: [SINGLE_SESSION_1],
      },
    });
    const result = await resp.json();
    expect(result.success).toBe(true);

    // Verify enrollment row exists
    const rows = await getEnrollments(page, memberId, SINGLE_COURSE_ID);
    const enrolled = rows.filter((r: any) => r.status === 'enrolled');
    expect(enrolled.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await cleanupEnrollments(page, memberId, SINGLE_COURSE_ID);
  });

  // ──────────────────────────────────────────────────────────────
  // HAPPY: in-window full enroll on an open card course succeeds
  // ──────────────────────────────────────────────────────────────
  test('HAPPY: full enroll on open card course succeeds', async ({ page }) => {
    await loginAs(page, 'member');

    // No-single course has enroll_full=true, in the open courseGroup
    await cleanupEnrollments(page, memberId, HAPPY_FULL_COURSE_ID);

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInCourses',
        courseIds: [HAPPY_FULL_COURSE_ID],
      },
    });
    const result = await resp.json();
    expect(result.success).toBe(true);

    // Verify enrollment row
    const rows = await getEnrollments(page, memberId, HAPPY_FULL_COURSE_ID);
    const enrolled = rows.filter((r: any) => r.status === 'enrolled');
    expect(enrolled.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await cleanupEnrollments(page, memberId, HAPPY_FULL_COURSE_ID);
  });

  // ──────────────────────────────────────────────────────────────
  // ADVERSARIAL (a): single enroll on enroll_single=false course
  // ──────────────────────────────────────────────────────────────
  test('ADVERSARIAL: batchEnrollInSessions rejects enroll_single=false course', async ({ page }) => {
    await loginAs(page, 'member');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInSessions',
        courseId: NO_SINGLE_COURSE_ID,
        sessionIds: [NO_SINGLE_SESSION],
      },
    });
    const result = await resp.json();
    expect(result.success).toBe(false);
    expect(result.message).toContain('未開放單堂報名');

    // No enrollment row created
    const rows = await getEnrollments(page, memberId, NO_SINGLE_COURSE_ID);
    const active = (rows || []).filter((r: any) => r.status === 'enrolled' || r.status === 'waitlist');
    expect(active.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // ADVERSARIAL (b): single enroll on past-window course
  // ──────────────────────────────────────────────────────────────
  test('ADVERSARIAL: batchEnrollInSessions rejects closed-window course', async ({ page }) => {
    await loginAs(page, 'member');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInSessions',
        courseId: CLOSED_WINDOW_COURSE,
        sessionIds: [CLOSED_WINDOW_SESSION],
      },
    });
    const result = await resp.json();
    expect(result.success).toBe(false);
    expect(result.message).toContain('已截止');

    // No enrollment row
    const rows = await getEnrollments(page, memberId, CLOSED_WINDOW_COURSE);
    const active = (rows || []).filter((r: any) => r.status === 'enrolled' || r.status === 'waitlist');
    expect(active.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // ADVERSARIAL (c): full enroll on closed-phase1 group course
  // ──────────────────────────────────────────────────────────────
  test('ADVERSARIAL: batchEnrollInCourses rejects closed-phase1-group course', async ({ page }) => {
    await loginAs(page, 'member');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInCourses',
        courseIds: [CLOSED_PHASE1_COURSE],
      },
    });
    const result = await resp.json();
    expect(result.success).toBe(false);
    expect(result.message).toContain('整期報名已截止');

    // No enrollment row
    const rows = await getEnrollments(page, memberId, CLOSED_PHASE1_COURSE);
    const active = (rows || []).filter((r: any) => r.status === 'enrolled' || r.status === 'waitlist');
    expect(active.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // ADVERSARIAL (d): card-path enroll on non-card (ntd) course
  // ──────────────────────────────────────────────────────────────
  test('ADVERSARIAL: batchEnrollInSessions rejects ntd course via card path', async ({ page }) => {
    await loginAs(page, 'member');

    const resp = await page.request.post(API_URL, {
      data: {
        action: 'batchEnrollInSessions',
        courseId: NTD_COURSE_ID,
        sessionIds: [NTD_SESSION_1],
      },
    });
    const result = await resp.json();
    expect(result.success).toBe(false);
    expect(result.message).toContain('不適用堂卡報名');

    // No enrollment row created (beyond the existing seed pending_payment)
    const rows = await getEnrollments(page, memberId, NTD_COURSE_ID);
    const cardEnrolled = (rows || []).filter((r: any) =>
      r.type === 'single' && (r.status === 'enrolled' || r.status === 'waitlist')
    );
    expect(cardEnrolled.length).toBe(0);
  });
});
