import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Multi-step group enrollment wizard (submitGroupEnrollment)
 *
 * Tests cover:
 *   HAPPY: mixed-mode submission (card-afford, card-shortfall+buyCards, MV, NTD)
 *   ADVERSARIAL (a): enroll_full=false rejection
 *   ADVERSARIAL (b): client-provided price ignored (server resolves price)
 *   ADVERSARIAL (c): capacity-full course rejection (no oversell)
 *   UI SMOKE: wizard flow renders and completes for an affordable card course
 *
 * All action-level tests call the real submitGroupEnrollment via the
 * e2e-test-actions API route.
 *
 * Fixtures (e2e/global-setup.ts):
 *   IDS.regGroup              - open-phase1 group for register wizard
 *   IDS.regCardAfford         - card, 1 card/session, 2 sessions (affordable)
 *   IDS.regCardShortfall      - card, 3 cards/session, 6 sessions (18 cards total, exceeds 15 balance)
 *   IDS.regMvCourse           - MV course with open poll
 *   IDS.regNtdCourse          - ntd, price_member_full=800
 *   IDS.regNoFullCourse       - enroll_full=false
 *   IDS.regFullCourse         - capacity-1, pre-filled by member2
 *   IDS.regFreeCourse         - free pricing_mode
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';

// IDs from global-setup.ts
const REG_GROUP_ID          = 'e2e00000-0000-0000-0000-000000000012';
const REG_CARD_AFFORD       = 'e2e00000-0000-0000-0000-0000000000b1';
const REG_CARD_SHORTFALL    = 'e2e00000-0000-0000-0000-0000000000b2';
const REG_MV_COURSE         = 'e2e00000-0000-0000-0000-0000000000b3';
const REG_NTD_COURSE        = 'e2e00000-0000-0000-0000-0000000000b4';
const REG_NO_FULL_COURSE    = 'e2e00000-0000-0000-0000-0000000000b5';
const REG_FULL_COURSE       = 'e2e00000-0000-0000-0000-0000000000b6';
const REG_FREE_COURSE       = 'e2e00000-0000-0000-0000-0000000000b7';

function getSupabaseEnv() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return { url, key };
}

/** Query enrollments for a user+course via admin client. */
async function getEnrollments(userId: string, courseId: string) {
    const sb = getAdminClient();
    const { data, error } = await sb
        .from('enrollments')
        .select('id, status, type, wants_leader, order_id')
        .eq('user_id', userId)
        .eq('course_id', courseId);
    if (error) throw new Error(`getEnrollments: ${error.message}`);
    return data ?? [];
}

/** Query orders by user + optional filters. */
async function getOrders(userId: string, orderType?: string, courseGroupId?: string) {
    const sb = getAdminClient();
    let query = sb.from('orders').select('*').eq('user_id', userId);
    if (orderType) query = query.eq('order_type', orderType);
    if (courseGroupId) query = query.eq('course_group_id', courseGroupId);
    const { data, error } = await query;
    if (error) throw new Error(`getOrders: ${error.message}`);
    return data ?? [];
}

/** Cleanup enrollments, card_transactions, and orders created by tests. */
async function cleanupTestData(userId: string) {
    const sb = getAdminClient();
    const regCourseIds = [
        REG_CARD_AFFORD, REG_CARD_SHORTFALL, REG_MV_COURSE,
        REG_NTD_COURSE, REG_NO_FULL_COURSE, REG_FULL_COURSE,
        REG_FREE_COURSE,
    ];

    // Get all test enrollments
    const { data: enrollments } = await sb.from('enrollments')
        .select('id, order_id')
        .eq('user_id', userId)
        .in('course_id', regCourseIds);

    if (enrollments?.length) {
        // Clean card_transactions linked to enrollments
        await sb.from('card_transactions').delete()
            .in('enrollment_id', enrollments.map(e => e.id));

        // Collect order_ids for cleanup
        const orderIds = [...new Set(enrollments.map(e => e.order_id).filter(Boolean))] as string[];

        // Delete enrollments
        await sb.from('enrollments').delete()
            .eq('user_id', userId)
            .in('course_id', regCourseIds);

        // Delete linked orders
        if (orderIds.length) {
            await sb.from('orders').delete().in('id', orderIds);
        }
    }

    // Also clean any course_fee orders for this group
    await sb.from('orders').delete()
        .eq('user_id', userId)
        .eq('course_group_id', REG_GROUP_ID);

    // Reset card balance to seed value (15)
    await sb.from('profiles').update({ card_balance: 15 }).eq('id', userId);

    // Reset card pool used counts to seed values
    await sb.from('orders').update({ used: 0 }).eq('id', 'e2e00000-0000-0000-0000-000000000040'); // card10: used=0
    await sb.from('orders').update({ used: 2 }).eq('id', 'e2e00000-0000-0000-0000-000000000041'); // card2: used=2
}

test.describe('Register Wizard — submitGroupEnrollment', () => {
    let memberId: string;

    test.beforeAll(async () => {
        memberId = await getUserIdByEmail('e2e-member@mediatek.com');
    });

    test.afterAll(async () => {
        await cleanupTestData(memberId);
    });

    // ──────────────────────────────────────────────────────────────
    // HAPPY: mixed-mode submission
    // ──────────────────────────────────────────────────────────────
    test('HAPPY: mixed submission — card afford, MV, NTD courses produce correct statuses + DB rows', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: REG_GROUP_ID,
                selections: [
                    { courseId: REG_CARD_AFFORD, mode: 'full', wantsLeader: true },
                    { courseId: REG_MV_COURSE, mode: 'full', wantsLeader: false },
                    { courseId: REG_NTD_COURSE, mode: 'full', wantsLeader: false },
                ],
            },
        });

        const result = await resp.json();
        expect(result.perCourse).toBeDefined();
        expect(result.perCourse).toHaveLength(3);

        // Find per-course results
        const cardResult = result.perCourse.find((r: any) => r.courseId === REG_CARD_AFFORD);
        const mvResult = result.perCourse.find((r: any) => r.courseId === REG_MV_COURSE);
        const ntdResult = result.perCourse.find((r: any) => r.courseId === REG_NTD_COURSE);

        // Assert statuses
        expect(cardResult.status).toBe('enrolled');
        expect(mvResult.status).toBe('pending_vote');
        expect(ntdResult.status).toBe('pending_payment');

        // Assert DB: card course enrollment is enrolled + balance decreased
        const cardEnrollments = await getEnrollments(memberId, REG_CARD_AFFORD);
        const cardEnrolled = cardEnrollments.find(e => e.status === 'enrolled' && e.type === 'full');
        expect(cardEnrolled).toBeTruthy();
        expect(cardEnrolled!.wants_leader).toBe(true);

        // Verify card balance decreased by 2 (1 card/session * 2 sessions)
        const sb = getAdminClient();
        const { data: profile } = await sb.from('profiles').select('card_balance').eq('id', memberId).single();
        expect(profile!.card_balance).toBe(13); // 15 - 2

        // Assert DB: MV enrollment is pending_vote with no order + no deduction
        const mvEnrollments = await getEnrollments(memberId, REG_MV_COURSE);
        const mvPending = mvEnrollments.find(e => e.status === 'pending_vote');
        expect(mvPending).toBeTruthy();
        expect(mvPending!.order_id).toBeNull();
        expect(mvPending!.wants_leader).toBe(false);

        // Assert DB: NTD enrollment is pending_payment + linked to course_fee order
        const ntdEnrollments = await getEnrollments(memberId, REG_NTD_COURSE);
        const ntdPending = ntdEnrollments.find(e => e.status === 'pending_payment');
        expect(ntdPending).toBeTruthy();
        expect(ntdPending!.order_id).toBeTruthy();

        // Assert the course_fee order amount = server-resolved price (800 for member)
        expect(result.orderId).toBeTruthy();
        const orders = await getOrders(memberId, 'course_fee', REG_GROUP_ID);
        const courseFeeOrder = orders.find(o => o.id === result.orderId);
        expect(courseFeeOrder).toBeTruthy();
        expect(courseFeeOrder!.amount).toBe(800);
        expect(courseFeeOrder!.status).toBe('pending');
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (a): enroll_full=false rejection
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: enroll_full=false course rejected, others succeed', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: REG_GROUP_ID,
                selections: [
                    { courseId: REG_NO_FULL_COURSE, mode: 'full', wantsLeader: false },
                    { courseId: REG_FREE_COURSE, mode: 'full', wantsLeader: false },
                ],
            },
        });

        const result = await resp.json();
        expect(result.perCourse).toHaveLength(2);

        const noFullResult = result.perCourse.find((r: any) => r.courseId === REG_NO_FULL_COURSE);
        const freeResult = result.perCourse.find((r: any) => r.courseId === REG_FREE_COURSE);

        // The enroll_full=false course is rejected
        expect(noFullResult.status).toBe('rejected');
        expect(noFullResult.reason).toContain('未開放整期報名');

        // The free course still succeeds
        expect(freeResult.status).toBe('enrolled');

        // Assert DB: no enrollment for rejected course
        const noFullEnrolls = await getEnrollments(memberId, REG_NO_FULL_COURSE);
        expect(noFullEnrolls.filter(e => e.status !== 'cancelled')).toHaveLength(0);

        // Assert DB: enrollment exists for free course
        const freeEnrolls = await getEnrollments(memberId, REG_FREE_COURSE);
        expect(freeEnrolls.filter(e => e.status === 'enrolled')).toHaveLength(1);
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (b): client-provided price ignored
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: client-provided amount ignored, order uses server-resolved price', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        // The client sends a bogus payload — note: the action NEVER reads client prices
        // We send it through anyway; the action should use resolvePrice -> 800 (member full)
        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: REG_GROUP_ID,
                selections: [
                    {
                        courseId: REG_NTD_COURSE,
                        mode: 'full',
                        wantsLeader: false,
                        // Bogus fields that should be ignored:
                        amount: 1,
                        price: 0,
                        totalAmount: 999999,
                    },
                ],
            },
        });

        const result = await resp.json();
        expect(result.perCourse).toHaveLength(1);
        expect(result.perCourse[0].status).toBe('pending_payment');

        // The key assertion: order amount = server-resolved price, NOT the client value
        expect(result.orderId).toBeTruthy();
        const orders = await getOrders(memberId, 'course_fee', REG_GROUP_ID);
        const order = orders.find(o => o.id === result.orderId);
        expect(order).toBeTruthy();
        expect(order!.amount).toBe(800); // resolvePrice(ntd, member, full) = price_member_full = 800
        expect(order!.amount).not.toBe(1);
        expect(order!.amount).not.toBe(999999);
    });

    // ──────────────────────────────────────────────────────────────
    // ADVERSARIAL (c): capacity-full course rejection (no oversell)
    // ──────────────────────────────────────────────────────────────
    test('ADVERSARIAL: capacity-1 full course produces status=full, others enrolled', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: REG_GROUP_ID,
                selections: [
                    { courseId: REG_FULL_COURSE, mode: 'full', wantsLeader: false },
                    { courseId: REG_FREE_COURSE, mode: 'full', wantsLeader: false },
                ],
            },
        });

        const result = await resp.json();
        expect(result.perCourse).toHaveLength(2);

        const fullResult = result.perCourse.find((r: any) => r.courseId === REG_FULL_COURSE);
        const freeResult = result.perCourse.find((r: any) => r.courseId === REG_FREE_COURSE);

        // The already-full course is rejected with status=full
        expect(fullResult.status).toBe('full');

        // The free course still succeeds
        expect(freeResult.status).toBe('enrolled');

        // Assert DB: no enrollment row for the full course (member has none)
        const fullEnrolls = await getEnrollments(memberId, REG_FULL_COURSE);
        expect(fullEnrolls.filter(e => e.status === 'enrolled')).toHaveLength(0);
    });

    // ──────────────────────────────────────────────────────────────
    // T1: card shortfall + buyCards => pending_payment + card_purchase order
    // ──────────────────────────────────────────────────────────────
    test('MONEY: card shortfall + buyCards => pending_payment enrollment + card_purchase order linked, balance unchanged', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        const BUY_QUANTITY = 5; // enough to cover 18-15=3 shortfall; meets typical min-purchase

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: REG_GROUP_ID,
                selections: [
                    { courseId: REG_CARD_SHORTFALL, mode: 'full', wantsLeader: false },
                ],
                buyCards: { quantity: BUY_QUANTITY },
            },
        });

        const result = await resp.json();
        expect(result.perCourse).toBeDefined();
        expect(result.perCourse).toHaveLength(1);

        // perCourse status must be pending_payment (not enrolled, not rejected)
        const shortfallResult = result.perCourse[0];
        expect(shortfallResult.courseId).toBe(REG_CARD_SHORTFALL);
        expect(shortfallResult.status).toBe('pending_payment');

        // Assert cardOrderId is returned
        expect(result.cardOrderId).toBeTruthy();

        // ── DB: enrollment row exists with status=pending_payment and order_id linked ──
        const enrollments = await getEnrollments(memberId, REG_CARD_SHORTFALL);
        const pendingEnroll = enrollments.find(e => e.status === 'pending_payment' && e.type === 'full');
        expect(pendingEnroll).toBeTruthy();
        expect(pendingEnroll!.order_id).toBeTruthy();
        expect(pendingEnroll!.order_id).toBe(result.cardOrderId);

        // ── DB: the linked order has order_type=card_purchase, correct quantity, status=pending ──
        const sb = getAdminClient();
        const { data: order } = await sb.from('orders')
            .select('*')
            .eq('id', result.cardOrderId)
            .single();
        expect(order).toBeTruthy();
        expect(order!.order_type).toBe('card_purchase');
        expect(order!.quantity).toBe(BUY_QUANTITY);
        expect(order!.status).toBe('pending');

        // ── DB: member card_balance is UNCHANGED (no immediate deduction) ──
        const { data: profile } = await sb.from('profiles')
            .select('card_balance')
            .eq('id', memberId)
            .single();
        expect(profile!.card_balance).toBe(15);
    });

    // ──────────────────────────────────────────────────────────────
    // T2: card shortfall + no buyCards => rejected + no enrollment
    // ──────────────────────────────────────────────────────────────
    test('MONEY: card shortfall + no buyCards => rejected with reason containing "堂卡不足", no enrollment row', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: REG_GROUP_ID,
                selections: [
                    { courseId: REG_CARD_SHORTFALL, mode: 'full', wantsLeader: false },
                ],
                // NO buyCards
            },
        });

        const result = await resp.json();
        expect(result.perCourse).toBeDefined();
        expect(result.perCourse).toHaveLength(1);

        // perCourse status must be rejected with reason containing the shortfall message
        const shortfallResult = result.perCourse[0];
        expect(shortfallResult.courseId).toBe(REG_CARD_SHORTFALL);
        expect(shortfallResult.status).toBe('rejected');
        expect(shortfallResult.reason).toContain('堂卡不足');

        // ── DB: NO enrollment row was created for this course ──
        const enrollments = await getEnrollments(memberId, REG_CARD_SHORTFALL);
        expect(enrollments.filter(e => e.status !== 'cancelled')).toHaveLength(0);

        // ── DB: card_balance is unchanged ──
        const sb = getAdminClient();
        const { data: profile } = await sb.from('profiles')
            .select('card_balance')
            .eq('id', memberId)
            .single();
        expect(profile!.card_balance).toBe(15);
    });

    // ──────────────────────────────────────────────────────────────
    // UI SMOKE: wizard renders, select course, complete
    // ──────────────────────────────────────────────────────────────
    test('UI SMOKE: wizard renders, selecting card course completes with enrolled', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupTestData(memberId);

        // Also clean up any stray card_transactions for this user
        const sb = getAdminClient();
        const { data: strayTx } = await sb.from('card_transactions')
            .select('id')
            .eq('user_id', memberId)
            .not('id', 'in', '(e2e00000-0000-0000-0000-000000000050,e2e00000-0000-0000-0000-000000000051)');
        if (strayTx?.length) {
            await sb.from('card_transactions').delete()
                .eq('user_id', memberId)
                .not('id', 'in', '(e2e00000-0000-0000-0000-000000000050,e2e00000-0000-0000-0000-000000000051)');
        }
        // Re-sync card balance after cleaning stray transactions
        await sb.from('profiles').update({ card_balance: 15 }).eq('id', memberId);
        await sb.from('orders').update({ used: 0 }).eq('id', 'e2e00000-0000-0000-0000-000000000040');

        await page.goto(`/courses/groups/${REG_GROUP_ID}/register`);

        // Step 1: select courses - wait for the select step to appear
        await expect(page.getByTestId('step-select')).toBeVisible();
        await expect(page.getByText('選課')).toBeVisible();

        // Select the affordable card course
        const courseOption = page.getByTestId(`course-option-${REG_CARD_AFFORD}`);
        await expect(courseOption).toBeVisible();
        await courseOption.click();

        // Click next
        await page.getByRole('button', { name: '下一步' }).click();

        // Step: leader (no MV step since affordable card course is not MV)
        await expect(page.getByTestId('step-leader')).toBeVisible();
        await page.getByRole('button', { name: '下一步' }).click();

        // Step: payment
        await expect(page.getByTestId('step-payment')).toBeVisible();

        // Listen for console errors
        const consoleErrors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.getByRole('button', { name: '確認報名' }).click();

        // Wait for either done step or a toast error
        const doneOrError = await Promise.race([
            page.getByTestId('step-done').waitFor({ state: 'visible', timeout: 20000 })
                .then(() => 'done' as const),
            page.locator('[data-sonner-toast][data-type="error"]').waitFor({ state: 'visible', timeout: 20000 })
                .then(() => 'error' as const),
        ]);

        if (doneOrError === 'error') {
            const errorText = await page.locator('[data-sonner-toast][data-type="error"]').textContent();
            throw new Error(`Server action returned error: ${errorText}. Console: ${consoleErrors.join(', ')}`);
        }

        // Step: done
        await expect(page.getByTestId('step-done')).toBeVisible();
        await expect(page.getByText('報名成功')).toBeVisible();

        // Assert DB: enrollment row
        const enrollments = await getEnrollments(memberId, REG_CARD_AFFORD);
        expect(enrollments.filter(e => e.status === 'enrolled')).toHaveLength(1);
    });
});
