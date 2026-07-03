import { test, expect } from '@playwright/test';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Adversarial concurrency test: two parallel enrollments on a capacity-1
 * session must result in EXACTLY ONE success and ONE rejection.
 *
 * This test validates the enroll_atomic RPC's row-level locking.
 * Without the FOR UPDATE lock, both requests would pass the capacity
 * check simultaneously and oversell the session.
 *
 * Uses direct RPC calls (not browser UI) for deterministic concurrency:
 * Promise.all fires both requests at the same instant, and Postgres
 * serializes them via the course row lock.
 */

const OVERSELL_COURSE_ID  = 'e2e00000-0000-0000-0000-000000000025';
const OVERSELL_SESSION_ID = 'e2e00000-0000-0000-0000-00000000003f';

test.describe('Oversell Guard (atomic enrollment)', () => {
  test('two concurrent enrollments on capacity-1 session: exactly one succeeds', async () => {
    const client = getAdminClient();

    const [memberId, member2Id] = await Promise.all([
      getUserIdByEmail('e2e-member@mediatek.com'),
      getUserIdByEmail('e2e-member2@mediatek.com'),
    ]);

    // Fire TWO enrollment RPCs concurrently via Promise.all
    const [res1, res2] = await Promise.all([
      client.rpc('enroll_atomic', {
        p_user: memberId,
        p_course: OVERSELL_COURSE_ID,
        p_type: 'single',
        p_session: OVERSELL_SESSION_ID,
        p_status: 'enrolled',
        p_cards_to_deduct: 0,
        p_order_id: null,
      }),
      client.rpc('enroll_atomic', {
        p_user: member2Id,
        p_course: OVERSELL_COURSE_ID,
        p_type: 'single',
        p_session: OVERSELL_SESSION_ID,
        p_status: 'enrolled',
        p_cards_to_deduct: 0,
        p_order_id: null,
      }),
    ]);

    // Neither call should return a PostgREST-level error
    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    const results = [res1.data, res2.data] as Array<{ ok: boolean; reason?: string; enrollment_id?: string }>;

    // Exactly one should succeed, one should be rejected as full
    const successes = results.filter(r => r.ok === true);
    const fulls     = results.filter(r => r.ok === false && r.reason === 'full');

    expect(successes).toHaveLength(1);
    expect(fulls).toHaveLength(1);

    // Verify the DB: exactly 1 active enrollment for that session
    const { data: enrollments, error: qErr } = await client
      .from('enrollments')
      .select('id, user_id, status')
      .eq('course_id', OVERSELL_COURSE_ID)
      .eq('session_id', OVERSELL_SESSION_ID)
      .in('status', ['enrolled', 'pending_payment', 'pending_vote']);

    expect(qErr).toBeNull();
    expect(enrollments).toHaveLength(1);
    expect(enrollments![0].status).toBe('enrolled');
  });
});
