import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient } from '../fixtures/db';

/**
 * Adversarial tests: pending enrollment restrictions + card-pool exhaustion (5R.6)
 *
 * A1-A3: pending_payment enrollments cannot leave/transfer/makeup (existing guards)
 * A4: card_purchase confirm with insufficient cards → order stays remitted
 *
 * Seed fixtures:
 *   - ntdPending (member, ntdCourse, pending_payment)
 *   - cardExhaustPending (member, cardExhaustCourse, pending_payment, order=cardExhaust)
 *   - cardExhaust order (remitted, qty=5, linked to 10-cards-needed enrollment)
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';
const NTD_COURSE_ID = 'e2e00000-0000-0000-0000-000000000004';
const NTD_SESSION_1 = 'e2e00000-0000-0000-0000-000000000034';
const BASIC_COURSE_ID = 'e2e00000-0000-0000-0000-000000000001';
const BASIC_FUTURE_SESSION = 'e2e00000-0000-0000-0000-000000000024';
const CARD_EXHAUST_ORDER = 'e2e00000-0000-0000-0000-000000000046';
const CARD10_ORDER = 'e2e00000-0000-0000-0000-000000000040';
const CARD_CUSTOM_EXPIRY_ORDER = 'e2e00000-0000-0000-0000-000000000043';

test.describe('Pending enrollment restrictions (5R.6)', () => {
    test('A1: pending_payment user cannot request leave', async ({ page }) => {
        await loginAs(page, 'member');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitLeaveRequest',
                courseId: NTD_COURSE_ID,
                sessionId: NTD_SESSION_1,
                reason: 'test leave',
            },
        });
        const result = await resp.json();

        expect(result.success).toBe(false);
        expect(result.message || result.error).toBeTruthy();
    });

    test('A2: pending_payment user cannot transfer', async ({ page }) => {
        await loginAs(page, 'member');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitTransferRequest',
                courseId: NTD_COURSE_ID,
                sessionId: NTD_SESSION_1,
                toUserId: null,
                toUserName: 'Test Person',
            },
        });
        const result = await resp.json();

        expect(result.success).toBe(false);
        expect(result.message || result.error).toBeTruthy();
    });

    test('A3: pending_payment user cannot use course as makeup source', async ({ page }) => {
        await loginAs(page, 'member');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitMakeupRequest',
                originalCourseId: NTD_COURSE_ID,
                originalSessionId: NTD_SESSION_1,
                targetCourseId: BASIC_COURSE_ID,
                targetSessionId: BASIC_FUTURE_SESSION,
            },
        });
        const result = await resp.json();

        expect(result.success).toBe(false);
        expect(result.message || result.error).toBeTruthy();
    });

    test('A4: card_purchase confirm with insufficient cards → order stays remitted', async ({ page }) => {
        const sb = getAdminClient();

        // Exhaust existing card pools so projected balance after confirm is too low
        await sb.from('orders').update({ used: 10 }).eq('id', CARD10_ORDER);
        await sb.from('orders').update({ used: 5 }).eq('id', CARD_CUSTOM_EXPIRY_ORDER);

        try {
            // Admin confirms the card_exhaust order (qty=5, but enrollment needs 10)
            await loginAs(page, 'admin');
            const resp = await page.request.post(API_URL, {
                data: { action: 'confirmOrder', orderId: CARD_EXHAUST_ORDER },
            });
            const result = await resp.json();

            // Should fail: projected = 0 + 5 = 5, needs 10
            expect(result.success).toBe(false);
            expect(result.message).toContain('堂卡不足');

            // Order stays remitted
            const { data: order } = await sb.from('orders')
                .select('status').eq('id', CARD_EXHAUST_ORDER).single();
            expect(order!.status).toBe('remitted');
        } finally {
            // Restore card pools to seed values
            await sb.from('orders').update({ used: 0 }).eq('id', CARD10_ORDER);
            await sb.from('orders').update({ used: 0 }).eq('id', CARD_CUSTOM_EXPIRY_ORDER);
        }
    });
});
