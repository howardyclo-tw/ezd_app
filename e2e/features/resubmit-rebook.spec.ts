import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Modify group enrollment via atomic void-and-rebook
 * (resubmitGroupEnrollment, Task 5.4)
 *
 * Tests cover:
 *   HAPPY: void prior card submission, rebook with different selection,
 *          verify cancellation, card refund, new enrollment, later enrolled_at.
 *   ADVERSARIAL (a): confirmed-order refusal — original stays intact.
 *   ADVERSARIAL (b): repeated resubmit conserves card balance and occupancy.
 *
 * All tests call the REAL resubmitGroupEnrollment via the e2e-test-actions
 * API route and assert DB state.
 *
 * Fixtures (e2e/global-setup.ts):
 *   IDS.resubGroup          - open-phase1 group for resubmit tests
 *   IDS.resubCardCourseA    - card, 2 cards/session, 2 sessions (4 cards total)
 *   IDS.resubCardCourseB    - card, 1 card/session, 2 sessions (2 cards total)
 *   IDS.resubConfCourse     - ntd, for confirmed-order test
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';

// IDs from global-setup.ts
const RESUB_GROUP_ID       = 'e2e00000-0000-0000-0000-000000000013';
const RESUB_CARD_COURSE_A  = 'e2e00000-0000-0000-0000-0000000000e1';
const RESUB_CARD_COURSE_B  = 'e2e00000-0000-0000-0000-0000000000e2';
const RESUB_CONF_COURSE    = 'e2e00000-0000-0000-0000-0000000000e3';

// Seed card order IDs (from global-setup)
const CARD10_ORDER_ID         = 'e2e00000-0000-0000-0000-000000000040';
const CARD2_ORDER_ID          = 'e2e00000-0000-0000-0000-000000000041';
const CARD_CUSTOM_EXPIRY_ID   = 'e2e00000-0000-0000-0000-000000000043';

const SEED_CARD_BALANCE = 15;  // card10(10-0) + card2(2-2) + cardCustom(5-0) = 15

/** Reset member card state and clean all resubmit test data. */
async function cleanupResubmitData(userId: string) {
    const sb = getAdminClient();
    const resubCourseIds = [RESUB_CARD_COURSE_A, RESUB_CARD_COURSE_B, RESUB_CONF_COURSE];

    // 1. Get all test enrollments for these courses
    const { data: enrollments } = await sb.from('enrollments')
        .select('id, order_id')
        .eq('user_id', userId)
        .in('course_id', resubCourseIds);

    if (enrollments?.length) {
        // Clean card_transactions linked to these enrollments
        await sb.from('card_transactions').delete()
            .in('enrollment_id', enrollments.map(e => e.id));

        // Collect order_ids
        const orderIds = [...new Set(enrollments.map(e => e.order_id).filter(Boolean))] as string[];

        // Delete enrollments
        await sb.from('enrollments').delete()
            .eq('user_id', userId)
            .in('course_id', resubCourseIds);

        // Delete linked orders (non-seed only)
        const seedOrderIds = [CARD10_ORDER_ID, CARD2_ORDER_ID, CARD_CUSTOM_EXPIRY_ID];
        const nonSeedOrders = orderIds.filter(id => !seedOrderIds.includes(id));
        if (nonSeedOrders.length) {
            await sb.from('orders').delete().in('id', nonSeedOrders);
        }
    }

    // 2. Clean any course_fee / other orders for resubGroup
    await sb.from('orders').delete()
        .eq('user_id', userId)
        .eq('course_group_id', RESUB_GROUP_ID);

    // 3. Clean non-seed card_transactions (refund txns etc.)
    const seedTxIds = ['e2e00000-0000-0000-0000-000000000050', 'e2e00000-0000-0000-0000-000000000051'];
    await sb.from('card_transactions').delete()
        .eq('user_id', userId)
        .not('id', 'in', `(${seedTxIds.join(',')})`);

    // 4. Reset card pools to seed values
    await sb.from('orders').update({ used: 0 }).eq('id', CARD10_ORDER_ID);
    await sb.from('orders').update({ used: 2 }).eq('id', CARD2_ORDER_ID);
    await sb.from('orders').update({ used: 0 }).eq('id', CARD_CUSTOM_EXPIRY_ID);

    // 5. Reset card_balance
    await sb.from('profiles').update({ card_balance: SEED_CARD_BALANCE }).eq('id', userId);
}

/** Query active enrollments for a user + course. */
async function getActiveEnrollments(userId: string, courseId: string) {
    const sb = getAdminClient();
    const { data, error } = await sb
        .from('enrollments')
        .select('id, status, type, enrolled_at, cancel_reason, order_id')
        .eq('user_id', userId)
        .eq('course_id', courseId);
    if (error) throw new Error(`getActiveEnrollments: ${error.message}`);
    return data ?? [];
}

/** Get profile card_balance. */
async function getCardBalance(userId: string): Promise<number> {
    const sb = getAdminClient();
    const { data } = await sb.from('profiles').select('card_balance').eq('id', userId).single();
    return data?.card_balance ?? -1;
}

/** Get a specific order by ID. */
async function getOrder(orderId: string) {
    const sb = getAdminClient();
    const { data } = await sb.from('orders').select('*').eq('id', orderId).single();
    return data;
}

test.describe('Resubmit Rebook — resubmitGroupEnrollment', () => {
    let memberId: string;

    test.beforeAll(async () => {
        memberId = await getUserIdByEmail('e2e-member@mediatek.com');
    });

    test.afterAll(async () => {
        await cleanupResubmitData(memberId);
    });

    // ──────────────────────────────────────────────────────────────
    // HAPPY: void prior card submission, rebook with different selection
    // ──────────────────────────────────────────────────────────────
    test('HAPPY: resubmit voids old enrollment, refunds cards, creates new enrollment with later enrolled_at', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupResubmitData(memberId);

        // ── Step 1: initial enrollment in courseA ──
        const submitResp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_A, mode: 'full', wantsLeader: false },
                ],
            },
        });
        const submitResult = await submitResp.json();
        expect(submitResult.perCourse).toBeDefined();
        const courseAResult = submitResult.perCourse.find((r: any) => r.courseId === RESUB_CARD_COURSE_A);
        expect(courseAResult.status).toBe('enrolled');

        // Verify cards deducted: 2 cards/session * 2 sessions = 4
        const balanceAfterSubmit = await getCardBalance(memberId);
        expect(balanceAfterSubmit).toBe(SEED_CARD_BALANCE - 4); // 15 - 4 = 11

        // Record original enrolled_at
        const originalEnrollments = await getActiveEnrollments(memberId, RESUB_CARD_COURSE_A);
        const originalEnroll = originalEnrollments.find(e => e.status === 'enrolled');
        expect(originalEnroll).toBeTruthy();
        const originalEnrolledAt = originalEnroll!.enrolled_at;

        // ── Step 2: resubmit with courseB (dropping courseA) ──
        const resubResp = await page.request.post(API_URL, {
            data: {
                action: 'resubmitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_B, mode: 'full', wantsLeader: true },
                ],
            },
        });
        const resubResult = await resubResp.json();

        // Should not have success:false (that would mean refusal)
        expect(resubResult.success).not.toBe(false);
        expect(resubResult.perCourse).toBeDefined();

        const courseBResult = resubResult.perCourse.find((r: any) => r.courseId === RESUB_CARD_COURSE_B);
        expect(courseBResult.status).toBe('enrolled');

        // ── Assert: old enrollment cancelled with correct reason ──
        const cancelledEnrolls = await getActiveEnrollments(memberId, RESUB_CARD_COURSE_A);
        const cancelled = cancelledEnrolls.find(e => e.status === 'cancelled');
        expect(cancelled).toBeTruthy();
        expect(cancelled!.cancel_reason).toBe('作廢重報');

        // ── Assert: new enrollment exists for courseB ──
        const newEnrolls = await getActiveEnrollments(memberId, RESUB_CARD_COURSE_B);
        const newEnroll = newEnrolls.find(e => e.status === 'enrolled');
        expect(newEnroll).toBeTruthy();

        // ── Assert: new enrolled_at is LATER than original ──
        expect(newEnroll!.enrolled_at > originalEnrolledAt).toBe(true);

        // ── Assert: card balance conservation ──
        // Net cost = courseB only: 1 card/session * 2 sessions = 2
        const finalBalance = await getCardBalance(memberId);
        expect(finalBalance).toBe(SEED_CARD_BALANCE - 2); // 15 - 2 = 13
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (a): confirmed-order refusal
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: confirmed linked order blocks resubmit, original intact', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupResubmitData(memberId);

        const sb = getAdminClient();

        // ── Set up: enrollment in confCourse with confirmed order ──
        // 1. Create a course_fee order with status=confirmed
        const { data: confOrder, error: orderErr } = await sb.from('orders').insert({
            user_id: memberId,
            order_type: 'course_fee',
            quantity: 1,
            used: 0,
            unit_price: 0,
            total_amount: 0,
            amount: 800,
            status: 'confirmed',
            course_group_id: RESUB_GROUP_ID,
            confirmed_at: new Date().toISOString(),
        }).select('id').single();
        expect(orderErr).toBeNull();
        const confOrderId = confOrder!.id;

        // 2. Create an enrollment linked to that confirmed order
        const { error: enrollErr } = await sb.from('enrollments').insert({
            course_id: RESUB_CONF_COURSE,
            user_id: memberId,
            status: 'enrolled',
            type: 'full',
            source: 'self',
            order_id: confOrderId,
        });
        expect(enrollErr).toBeNull();

        // ── Attempt resubmit — should REFUSE ──
        const resubResp = await page.request.post(API_URL, {
            data: {
                action: 'resubmitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_B, mode: 'full', wantsLeader: false },
                ],
            },
        });
        const resubResult = await resubResp.json();

        // Refusal check
        expect(resubResult.success).toBe(false);
        expect(resubResult.message).toBeTruthy();

        // ── Assert: original enrollment STILL active ──
        const enrolls = await getActiveEnrollments(memberId, RESUB_CONF_COURSE);
        const active = enrolls.find(e => e.status === 'enrolled');
        expect(active).toBeTruthy();
        expect(active!.order_id).toBe(confOrderId);

        // ── Assert: order STILL confirmed ──
        const order = await getOrder(confOrderId);
        expect(order).toBeTruthy();
        expect(order!.status).toBe('confirmed');

        // ── Assert: no enrollment was created for courseB ──
        const courseBEnrolls = await getActiveEnrollments(memberId, RESUB_CARD_COURSE_B);
        const courseBActive = courseBEnrolls.filter(
            e => ['enrolled', 'pending_payment', 'pending_vote'].includes(e.status)
        );
        expect(courseBActive).toHaveLength(0);

        // ── Assert: card balance untouched ──
        const balance = await getCardBalance(memberId);
        expect(balance).toBe(SEED_CARD_BALANCE);
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (b): conservation under repeated resubmit
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: repeated resubmit conserves balance, no duplicate enrollments', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupResubmitData(memberId);

        // ── Step 1: initial enrollment in courseA ──
        const submitResp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_A, mode: 'full', wantsLeader: false },
                ],
            },
        });
        const submitResult = await submitResp.json();
        expect(submitResult.perCourse[0].status).toBe('enrolled');

        // ── Step 2: first resubmit — courseA -> courseB ──
        const resub1Resp = await page.request.post(API_URL, {
            data: {
                action: 'resubmitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_B, mode: 'full', wantsLeader: false },
                ],
            },
        });
        const resub1 = await resub1Resp.json();
        expect(resub1.success).not.toBe(false);
        expect(resub1.perCourse[0].status).toBe('enrolled');

        // Balance after first resubmit: 15 - 2 (courseB cost) = 13
        const balanceAfter1 = await getCardBalance(memberId);
        expect(balanceAfter1).toBe(13);

        // ── Step 3: second resubmit — courseB -> courseB (same payload) ──
        const resub2Resp = await page.request.post(API_URL, {
            data: {
                action: 'resubmitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_B, mode: 'full', wantsLeader: false },
                ],
            },
        });
        const resub2 = await resub2Resp.json();
        expect(resub2.success).not.toBe(false);
        expect(resub2.perCourse[0].status).toBe('enrolled');

        // ── Assert: balance CONSERVED (no double-refund) ──
        // Correct: 15 - 2 = 13 (same as after first resubmit)
        // Double-refund would show 15 (refunded courseB twice, deducted once)
        const finalBalance = await getCardBalance(memberId);
        expect(finalBalance).toBe(13);

        // ── Assert: exactly 1 active enrollment for courseB ──
        const courseBEnrolls = await getActiveEnrollments(memberId, RESUB_CARD_COURSE_B);
        const activeB = courseBEnrolls.filter(
            e => ['enrolled', 'pending_payment', 'pending_vote'].includes(e.status)
        );
        expect(activeB).toHaveLength(1);

        // ── Assert: no active enrollment for courseA ──
        const courseAEnrolls = await getActiveEnrollments(memberId, RESUB_CARD_COURSE_A);
        const activeA = courseAEnrolls.filter(
            e => ['enrolled', 'pending_payment', 'pending_vote'].includes(e.status)
        );
        expect(activeA).toHaveLength(0);

        // ── Assert: occupancy for courseB sessions = 1 (member only) ──
        const sb = getAdminClient();
        const { count: fullCountB } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', RESUB_CARD_COURSE_B)
            .eq('type', 'full')
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']);
        expect(fullCountB).toBe(1);

        // ── Assert: occupancy for courseA sessions = 0 ──
        const { count: fullCountA } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', RESUB_CARD_COURSE_A)
            .eq('type', 'full')
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']);
        expect(fullCountA).toBe(0);
    });
});
