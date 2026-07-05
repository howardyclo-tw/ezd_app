import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Modify-as-rebook UI (5R.3)
 *
 * Tests the /register page's modify flow:
 *   H1: member with existing enrollment → summary card → modify warning → wizard → resubmit succeeds
 *   A1: member with confirmed order → modify fails with "已確認付款" message, DB unchanged
 *
 * Uses resubGroup fixtures (e2e/global-setup.ts):
 *   - IDS.resubGroup ('e2e-resub'):       open phase1 window
 *   - IDS.resubCardCourseA (2 cards/session × 2 sessions = 4 cards)
 *   - IDS.resubCardCourseB (1 card/session × 2 sessions = 2 cards)
 *   - IDS.resubConfCourse (NTD, price 800 member-full)
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';
const RESUB_GROUP_ID = 'e2e00000-0000-0000-0000-000000000013';
const RESUB_CARD_COURSE_A = 'e2e00000-0000-0000-0000-0000000000e1';
const RESUB_CARD_COURSE_B = 'e2e00000-0000-0000-0000-0000000000e2';
const RESUB_CONF_COURSE = 'e2e00000-0000-0000-0000-0000000000e3';

async function cleanupResubmitData(memberId: string) {
    const sb = getAdminClient();
    const courseIds = [RESUB_CARD_COURSE_A, RESUB_CARD_COURSE_B, RESUB_CONF_COURSE];
    for (const courseId of courseIds) {
        const { data: enrolls } = await sb.from('enrollments').select('id, order_id')
            .eq('course_id', courseId).eq('user_id', memberId);
        if (enrolls?.length) {
            await sb.from('card_transactions').delete()
                .in('enrollment_id', enrolls.map(e => e.id));
            await sb.from('enrollments').delete()
                .in('id', enrolls.map(e => e.id));
        }
    }
    await sb.from('orders').delete()
        .eq('user_id', memberId).eq('course_group_id', RESUB_GROUP_ID);
    await sb.from('orders').update({ used: 0 }).eq('id', 'e2e00000-0000-0000-0000-000000000040');
    await sb.from('orders').update({ used: 2 }).eq('id', 'e2e00000-0000-0000-0000-000000000041');
    await sb.from('orders').update({ used: 0 }).eq('id', 'e2e00000-0000-0000-0000-000000000043');
    await sb.from('profiles').update({ card_balance: 15 }).eq('id', memberId);
}

async function getCardBalance(memberId: string): Promise<number> {
    const sb = getAdminClient();
    const { data } = await sb.from('profiles').select('card_balance').eq('id', memberId).single();
    return data!.card_balance;
}

test.describe('Register Modify UI (5R.3)', () => {
    test.describe.configure({ timeout: 180_000 });
    let memberId: string;

    test.beforeAll(async () => {
        memberId = await getUserIdByEmail('e2e-member@mediatek.com');
    });

    test.afterAll(async () => {
        await cleanupResubmitData(memberId);
    });

    test('H1: existing enrollment → summary card → modify → resubmit succeeds with new selections', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupResubmitData(memberId);

        // Step 1: Create initial enrollment in courseA via test route
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

        const balanceAfterInitial = await getCardBalance(memberId);
        expect(balanceAfterInitial).toBe(15 - 4); // 2 cards/session × 2 sessions

        // Step 2: Navigate to /register → should see summary card
        await page.goto('/courses/groups/e2e-resub/register');
        await expect(page.getByRole('heading', { name: '目前報名' })).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('existing-enrollments')).toBeVisible();
        const summary = page.getByTestId('existing-enrollments');
        await expect(summary.getByText('E2E Resub Card A')).toBeVisible();
        await expect(summary.getByText('已成立')).toBeVisible();

        // Step 3: Click modify → warning dialog
        await page.getByRole('button', { name: '修改報名' }).click();
        await expect(page.getByText('確定要修改報名？')).toBeVisible();
        await expect(page.getByText('作廢目前的報名')).toBeVisible();

        // Step 4: Confirm → enters wizard
        await page.getByRole('button', { name: '確認修改' }).click();
        await expect(page.getByRole('heading', { name: '修改報名' })).toBeVisible({ timeout: 10000 });

        // Step 5: Select courseB (different from initial courseA)
        await page.getByText('E2E Resub Card B').click();
        // Navigate through wizard: select → leader → payment → submit
        await page.getByRole('button', { name: /下一步/ }).click();
        // Leader step
        await page.getByRole('button', { name: /下一步/ }).click();
        // Payment step → submit
        await page.getByRole('button', { name: /確認報名/ }).click();

        // Step 6: Verify done step
        await expect(page.getByTestId('step-done')).toBeVisible({ timeout: 15000 });

        // Step 7: Verify DB state — old enrollment cancelled, new enrolled, cards refunded+re-deducted
        const sb = getAdminClient();
        const { data: allEnrolls } = await sb.from('enrollments')
            .select('course_id, status, type, enrolled_at')
            .eq('user_id', memberId)
            .in('course_id', [RESUB_CARD_COURSE_A, RESUB_CARD_COURSE_B, RESUB_CONF_COURSE])
            .order('enrolled_at', { ascending: false });

        const activeA = allEnrolls?.find(e => e.course_id === RESUB_CARD_COURSE_A && e.status !== 'cancelled');
        const activeB = allEnrolls?.find(e => e.course_id === RESUB_CARD_COURSE_B && e.status === 'enrolled');
        expect(activeA).toBeUndefined(); // courseA should be cancelled
        expect(activeB).toBeDefined(); // courseB should be enrolled

        // Balance: started 15, initial -4 (courseA), void +4, rebook -2 (courseB 1×2) = 13
        const finalBalance = await getCardBalance(memberId);
        expect(finalBalance).toBe(13);
    });

    test('A1: confirmed order blocks modify — UI shows error, DB unchanged', async ({ page }) => {
        await loginAs(page, 'member');
        await cleanupResubmitData(memberId);

        // Step 1: Create enrollment in NTD course → pending_payment + order
        const submitResp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CONF_COURSE, mode: 'full', wantsLeader: false },
                ],
            },
        });
        const submitResult = await submitResp.json();
        expect(submitResult.perCourse[0].status).toBe('pending_payment');
        const orderId = submitResult.orderId;
        expect(orderId).toBeTruthy();

        // Step 2: Admin confirms the order
        await loginAs(page, 'admin');
        const confirmResp = await page.request.post(API_URL, {
            data: { action: 'confirmOrder', orderId },
        });
        const confirmResult = await confirmResp.json();
        expect(confirmResult.success).not.toBe(false);

        // Step 3: Switch back to member, navigate to /register
        await loginAs(page, 'member');
        await page.goto('/courses/groups/e2e-resub/register');
        await expect(page.getByRole('heading', { name: '目前報名' })).toBeVisible({ timeout: 15000 });

        // Step 4: Click modify → confirm warning
        await page.getByRole('button', { name: '修改報名' }).click();
        await page.getByRole('button', { name: '確認修改' }).click();
        await expect(page.getByRole('heading', { name: '修改報名' })).toBeVisible({ timeout: 10000 });

        // Step 5: Select a different course and submit
        await page.getByText('E2E Resub Card A').click();
        await page.getByRole('button', { name: /下一步/ }).click();
        await page.getByRole('button', { name: /下一步/ }).click();
        await page.getByRole('button', { name: /確認報名/ }).click();

        // Step 6: Should see error toast about confirmed order
        await expect(page.getByText('無法作廢重報')).toBeVisible({ timeout: 15000 });

        // Step 7: Verify DB unchanged — original enrollment still active
        const sb = getAdminClient();
        const { data: enrollments } = await sb.from('enrollments')
            .select('course_id, status')
            .eq('user_id', memberId)
            .eq('course_id', RESUB_CONF_COURSE)
            .neq('status', 'cancelled');

        expect(enrollments?.length).toBe(1);
        expect(enrollments![0].status).toBe('enrolled'); // confirmed order upgraded to enrolled
    });
});
