import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Feature test: Personal center payments (5R.5)
 *
 * Tests:
 *   H1: owner submits remittance info → order status pending → remitted
 *   H2: owner cancels pending order → order + enrollment cancelled, seat released
 *   A1: non-owner (guest) cancel on member's order → rejected
 *
 * Dynamically creates NTD enrollments via submitGroupEnrollment in identGroup
 * (open phase1 window, NTD pricing). Each run starts from seed-clean state
 * because global-setup now cleans identity group enrollments/orders.
 */

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';
const IDENT_GROUP_ID = 'e2e00000-0000-0000-0000-000000000014';
const IDENT_NTD_COURSE = 'e2e00000-0000-0000-0000-0000000001a2';
const IDENT_NTD_NO_GP = 'e2e00000-0000-0000-0000-0000000001a5';

test.describe.configure({ mode: 'serial' });

test.describe('Personal center payments (5R.5)', () => {
    let memberId: string;
    let orderId1: string;
    let orderId2: string;

    test.beforeAll(async () => {
        memberId = await getUserIdByEmail('e2e-member@mediatek.com');
    });

    test('Setup: create NTD enrollments with pending orders', async ({ page }) => {
        await loginAs(page, 'member');

        const resp1 = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: IDENT_GROUP_ID,
                selections: [{ courseId: IDENT_NTD_COURSE, mode: 'full', wantsLeader: false }],
            },
        });
        const result1 = await resp1.json();
        expect(result1.orderId, 'identNtdCourse should produce a course_fee order').toBeTruthy();
        orderId1 = result1.orderId;

        const resp2 = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: IDENT_GROUP_ID,
                selections: [{ courseId: IDENT_NTD_NO_GP, mode: 'full', wantsLeader: false }],
            },
        });
        const result2 = await resp2.json();
        expect(result2.orderId, 'identNtdNoGP should produce a course_fee order').toBeTruthy();
        orderId2 = result2.orderId;

        // Verify both orders are pending
        const sb = getAdminClient();
        const { data: orders } = await sb.from('orders')
            .select('id, status')
            .in('id', [orderId1, orderId2]);
        expect(orders).toHaveLength(2);
        expect(orders!.every(o => o.status === 'pending')).toBe(true);
    });

    test('A1: non-owner cancel is rejected', async ({ page }) => {
        await loginAs(page, 'guest');

        const resp = await page.request.post(API_URL, {
            data: { action: 'cancelOrder', orderId: orderId1 },
        });
        const result = await resp.json();

        expect(result.success).toBe(false);
        expect(result.message).toContain('訂單本人');

        // Order still pending
        const sb = getAdminClient();
        const { data: order } = await sb.from('orders')
            .select('status').eq('id', orderId1).single();
        expect(order!.status).toBe('pending');
    });

    test('H1: owner submits remittance → order becomes remitted', async ({ page }) => {
        await loginAs(page, 'member');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitRemittanceInfo',
                orderId: orderId1,
                bankCode: '808',
                last5: '12345',
                remittanceDate: '2026-07-05',
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        const sb = getAdminClient();
        const { data: order } = await sb.from('orders')
            .select('status, remittance_bank_code, remittance_account_last5, remittance_date')
            .eq('id', orderId1).single();
        expect(order!.status).toBe('remitted');
        expect(order!.remittance_bank_code).toBe('808');
        expect(order!.remittance_account_last5).toBe('12345');
    });

    test('H2: owner cancel → order + enrollment cancelled, seat released', async ({ page }) => {
        await loginAs(page, 'member');
        const sb = getAdminClient();

        // Snapshot occupying seats before cancel
        const { count: seatsBefore } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', IDENT_NTD_NO_GP)
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']);

        const resp = await page.request.post(API_URL, {
            data: { action: 'cancelOrder', orderId: orderId2 },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        // Order is cancelled
        const { data: order } = await sb.from('orders')
            .select('status').eq('id', orderId2).single();
        expect(order!.status).toBe('cancelled');

        // Enrollment is cancelled with reason
        const { data: enrollments } = await sb.from('enrollments')
            .select('status, cancel_reason')
            .eq('order_id', orderId2);
        expect(enrollments!.length).toBeGreaterThan(0);
        expect(enrollments![0].status).toBe('cancelled');
        expect(enrollments![0].cancel_reason).toBeTruthy();

        // Seat released
        const { count: seatsAfter } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', IDENT_NTD_NO_GP)
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']);
        expect(seatsAfter!).toBe(seatsBefore! - 1);
    });
});
