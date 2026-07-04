import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Single-session add-enrollment pricing-aware (card / ntd / free)
 *                + server-enforced no-self-cancel
 *
 * HAPPY:
 *   (1) NTD single-enroll -> enrollment status=pending_payment, linked order amount = server price
 *   (2) Free single-enroll -> enrollment status=enrolled, no order, no card deduction
 *
 * ADVERSARIAL:
 *   (3) Enrolled member calls cancelEnrollment -> rejected, enrollment unchanged
 *   (4) Guest enrolled in free course calls cancelEnrollment -> rejected, enrollment unchanged
 *   (5) Client-price-ignored: NTD enroll with bogus amount -> order amount = server-resolved price
 *
 * Fixtures (e2e/global-setup.ts):
 *   IDS.singleAddNtd   - ntd, price_member_single=300, price_guest_single=400
 *   IDS.singleAddFree  - free
 *   IDS.course (Basic Groove) - member has enrolled full enrollment (memberFull)
 *   IDS.enrollments.guestFreeEnrolled - guest enrolled in singleAddFree
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';

// IDs from global-setup.ts
const SINGLE_ADD_NTD     = 'e2e00000-0000-0000-0000-000000000029';
const SINGLE_ADD_FREE    = 'e2e00000-0000-0000-0000-00000000002a';
const NTD_SESSION_1      = 'e2e00000-0000-0000-0000-0000000000a4';
const FREE_SESSION_1     = 'e2e00000-0000-0000-0000-0000000000a5';
const BASIC_GROOVE_COURSE = 'e2e00000-0000-0000-0000-000000000020';
const COURSE_GROUP       = 'e2e00000-0000-0000-0000-000000000010';
const MEMBER_FULL_ENROLLMENT = 'e2e00000-0000-0000-0000-000000000060';
const GUEST_FREE_ENROLLMENT  = 'e2e00000-0000-0000-0000-000000000066';

/** Query enrollments for a user+course via admin client. */
async function getEnrollments(userId: string, courseId: string) {
    const sb = getAdminClient();
    const { data, error } = await sb
        .from('enrollments')
        .select('id, status, type, order_id, session_id')
        .eq('user_id', userId)
        .eq('course_id', courseId);
    if (error) throw new Error(`getEnrollments: ${error.message}`);
    return data ?? [];
}

/** Query orders by user + filters. */
async function getOrders(userId: string, orderType?: string, courseGroupId?: string) {
    const sb = getAdminClient();
    let query = sb.from('orders').select('*').eq('user_id', userId);
    if (orderType) query = query.eq('order_type', orderType);
    if (courseGroupId) query = query.eq('course_group_id', courseGroupId);
    const { data, error } = await query;
    if (error) throw new Error(`getOrders: ${error.message}`);
    return data ?? [];
}

/** Cleanup test-created enrollments, card_transactions, and orders for member in target courses. */
async function cleanupTestData(memberId: string) {
    const sb = getAdminClient();
    const courseIds = [SINGLE_ADD_NTD, SINGLE_ADD_FREE];

    for (const courseId of courseIds) {
        const { data: enrollments } = await sb.from('enrollments')
            .select('id, order_id')
            .eq('user_id', memberId)
            .eq('course_id', courseId);

        if (enrollments?.length) {
            await sb.from('card_transactions').delete()
                .in('enrollment_id', enrollments.map(e => e.id));

            const orderIds = [...new Set(enrollments.map(e => e.order_id).filter(Boolean))] as string[];

            await sb.from('enrollments').delete()
                .eq('user_id', memberId)
                .eq('course_id', courseId);

            if (orderIds.length) {
                await sb.from('orders').delete().in('id', orderIds);
            }
        }
    }

    // Also clean any course_fee orders for member in courseGroup (from NTD enrollment)
    // but preserve seed orders
    const seedOrderIds = [
        'e2e00000-0000-0000-0000-000000000040',
        'e2e00000-0000-0000-0000-000000000041',
        'e2e00000-0000-0000-0000-000000000042',
        'e2e00000-0000-0000-0000-000000000043',
    ];
    const { data: extraOrders } = await sb.from('orders')
        .select('id')
        .eq('user_id', memberId)
        .eq('course_group_id', COURSE_GROUP)
        .eq('order_type', 'course_fee')
        .not('id', 'in', `(${seedOrderIds.join(',')})`);
    if (extraOrders?.length) {
        await sb.from('orders').delete().in('id', extraOrders.map(o => o.id));
    }
}

test.describe('Single-Add Enrollment (pricing-aware) + No-Self-Cancel', () => {
    let memberId: string;
    let guestId: string;

    test.beforeAll(async () => {
        memberId = await getUserIdByEmail('e2e-member@mediatek.com');
        guestId = await getUserIdByEmail('e2e-guest@mediatek.com');
    });

    test.afterAll(async () => {
        await cleanupTestData(memberId);
    });

    // ──────────────────────────────────────────────────────────────
    // HAPPY (1): NTD single-enroll -> pending_payment + order
    // ──────────────────────────────────────────────────────────────
    test('HAPPY: ntd single-enroll creates pending_payment enrollment + course_fee order with server price', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        // Record initial card balance
        const sb = getAdminClient();
        const { data: profileBefore } = await sb.from('profiles').select('card_balance').eq('id', memberId).single();
        const balanceBefore = profileBefore!.card_balance;

        // Call batchEnrollInSessions on NTD course
        const resp = await page.request.post(API_URL, {
            data: {
                action: 'batchEnrollInSessions',
                courseId: SINGLE_ADD_NTD,
                sessionIds: [NTD_SESSION_1],
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);
        expect(result.message).toContain('繳費');

        // DB: enrollment should be pending_payment
        const enrollments = await getEnrollments(memberId, SINGLE_ADD_NTD);
        const pending = enrollments.find(e =>
            e.status === 'pending_payment' && e.type === 'single' && e.session_id === NTD_SESSION_1
        );
        expect(pending).toBeTruthy();
        expect(pending!.order_id).toBeTruthy();

        // DB: course_fee order amount = server-resolved member single price (300)
        const orders = await getOrders(memberId, 'course_fee', COURSE_GROUP);
        const linkedOrder = orders.find(o => o.id === pending!.order_id);
        expect(linkedOrder).toBeTruthy();
        expect(linkedOrder!.amount).toBe(300); // price_member_single
        expect(linkedOrder!.status).toBe('pending');

        // DB: card balance unchanged (no deduction for NTD)
        const { data: profileAfter } = await sb.from('profiles').select('card_balance').eq('id', memberId).single();
        expect(profileAfter!.card_balance).toBe(balanceBefore);
    });

    // ──────────────────────────────────────────────────────────────
    // HAPPY (2): Free single-enroll -> enrolled immediately
    // ──────────────────────────────────────────────────────────────
    test('HAPPY: free single-enroll creates enrolled enrollment, no order, no deduction', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        const sb = getAdminClient();
        const { data: profileBefore } = await sb.from('profiles').select('card_balance').eq('id', memberId).single();
        const balanceBefore = profileBefore!.card_balance;

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'batchEnrollInSessions',
                courseId: SINGLE_ADD_FREE,
                sessionIds: [FREE_SESSION_1],
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        // DB: enrollment should be enrolled immediately
        const enrollments = await getEnrollments(memberId, SINGLE_ADD_FREE);
        const enrolled = enrollments.find(e =>
            e.status === 'enrolled' && e.type === 'single' && e.session_id === FREE_SESSION_1
        );
        expect(enrolled).toBeTruthy();
        // No order linked
        expect(enrolled!.order_id).toBeNull();

        // No course_fee order created (filter by non-seed)
        const orders = await getOrders(memberId, 'course_fee', COURSE_GROUP);
        const newOrders = orders.filter(o =>
            o.id !== 'e2e00000-0000-0000-0000-000000000042' // seed courseFee
        );
        // Only the seed order should exist (no new order from free enrollment)
        const freeLinkedOrder = newOrders.find(o => o.status === 'pending');
        expect(freeLinkedOrder).toBeFalsy();

        // Card balance unchanged
        const { data: profileAfter } = await sb.from('profiles').select('card_balance').eq('id', memberId).single();
        expect(profileAfter!.card_balance).toBe(balanceBefore);
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (3): enrolled member cannot self-cancel
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: enrolled member self-cancel is rejected, enrollment unchanged', async ({ page }) => {
        await loginAs(page, 'member');

        // Member has seed enrollment memberFull (enrolled) in Basic Groove
        const resp = await page.request.post(API_URL, {
            data: {
                action: 'cancelEnrollment',
                courseId: BASIC_GROOVE_COURSE,
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(false);
        expect(result.message).toContain('無法自行取消');

        // DB: enrollment status is still enrolled
        const sb = getAdminClient();
        const { data: enrollment } = await sb.from('enrollments')
            .select('status')
            .eq('id', MEMBER_FULL_ENROLLMENT)
            .single();
        expect(enrollment).not.toBeNull();
        expect(enrollment!.status).toBe('enrolled');
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (4): guest enrolled in free course cannot self-cancel
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: guest enrolled in free course self-cancel is rejected, enrollment unchanged', async ({ page }) => {
        await loginAs(page, 'guest');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'cancelEnrollment',
                courseId: SINGLE_ADD_FREE,
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(false);
        expect(result.message).toContain('無法自行取消');

        // DB: enrollment status is still enrolled
        const sb = getAdminClient();
        const { data: enrollment } = await sb.from('enrollments')
            .select('status')
            .eq('id', GUEST_FREE_ENROLLMENT)
            .single();
        expect(enrollment).not.toBeNull();
        expect(enrollment!.status).toBe('enrolled');
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (5): client-price-ignored for NTD single-enroll
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: ntd single-enroll ignores bogus client amount, order uses server price', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        // Send a bogus amount field in the payload (should be ignored)
        const resp = await page.request.post(API_URL, {
            data: {
                action: 'batchEnrollInSessions',
                courseId: SINGLE_ADD_NTD,
                sessionIds: [NTD_SESSION_1],
                amount: 99999, // bogus -- server must ignore this
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        // DB: the created order amount = server-resolved price (300), NOT 99999
        const enrollments = await getEnrollments(memberId, SINGLE_ADD_NTD);
        const pending = enrollments.find(e =>
            e.status === 'pending_payment' && e.type === 'single'
        );
        expect(pending).toBeTruthy();
        expect(pending!.order_id).toBeTruthy();

        const sb = getAdminClient();
        const { data: order } = await sb.from('orders')
            .select('amount, status')
            .eq('id', pending!.order_id)
            .single();
        expect(order).not.toBeNull();
        expect(order!.amount).toBe(300); // server-resolved member single price
        expect(order!.amount).not.toBe(99999);
    });
});
