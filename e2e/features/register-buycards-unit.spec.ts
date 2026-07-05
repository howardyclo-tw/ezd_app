import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Embedded card-purchase unit validation (5R.4)
 *
 * Adversarial: calling submitGroupEnrollment with a non-multiple buyCards
 * quantity is fail-fast rejected — no enrollments or orders created.
 *
 * Uses resubGroup fixtures (open phase1 window, card pricing).
 * Snapshot-based: compares DB state before/after the call to avoid
 * cross-test cleanup dependencies.
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';
const RESUB_GROUP_ID = 'e2e00000-0000-0000-0000-000000000013';
const RESUB_CARD_COURSE_A = 'e2e00000-0000-0000-0000-0000000000e1';

test.describe('Card purchase unit validation in group enrollment (5R.4)', () => {
    let memberId: string;

    test.beforeAll(async () => {
        memberId = await getUserIdByEmail('e2e-member@mediatek.com');
    });

    test('A1: non-multiple buyCards quantity is rejected — no side effects', async ({ page }) => {
        await loginAs(page, 'member');
        const sb = getAdminClient();

        // Snapshot state BEFORE the call
        const { count: enrollBefore } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', memberId).eq('course_id', RESUB_CARD_COURSE_A);
        const { count: orderBefore } = await sb.from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', memberId);
        const { data: profileBefore } = await sb.from('profiles')
            .select('card_balance').eq('id', memberId).single();

        // Submit with quantity=7 (not a multiple of 5, the default unit)
        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: RESUB_GROUP_ID,
                selections: [
                    { courseId: RESUB_CARD_COURSE_A, mode: 'full', wantsLeader: false },
                ],
                buyCards: { quantity: 7 },
            },
        });
        const result = await resp.json();

        // Should be rejected with a clear message about multiples
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/倍數/);

        // Verify NO new enrollment was created
        const { count: enrollAfter } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', memberId).eq('course_id', RESUB_CARD_COURSE_A);
        expect(enrollAfter).toBe(enrollBefore);

        // Verify NO new order was created
        const { count: orderAfter } = await sb.from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', memberId);
        expect(orderAfter).toBe(orderBefore);

        // Verify balance unchanged
        const { data: profileAfter } = await sb.from('profiles')
            .select('card_balance').eq('id', memberId).single();
        expect(profileAfter!.card_balance).toBe(profileBefore!.card_balance);
    });
});
