import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient } from '../fixtures/db';

const API_URL = 'http://[::1]:3000/api/e2e-test-actions';
const JOURNEY_GROUP = 'e2e00000-0000-0000-0000-0000000001e0';
const JOURNEY_NTD_A = 'e2e00000-0000-0000-0000-0000000001d1';
const JOURNEY_NTD_B = 'e2e00000-0000-0000-0000-0000000001d2';

let orderIdA: string;
let orderIdB: string;

test.describe.serial('Student journey (5R.8)', () => {
    test('S0: setup — member enrolls in two NTD courses via group wizard', async ({ page }) => {
        await loginAs(page, 'member');

        const respA = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: JOURNEY_GROUP,
                selections: [{ courseId: JOURNEY_NTD_A, mode: 'full', wantsLeader: false }],
            },
        });
        const resultA = await respA.json();
        expect(resultA.perCourse, `enrollment A failed: ${JSON.stringify(resultA)}`).toBeTruthy();
        expect(resultA.orderId).toBeTruthy();
        orderIdA = resultA.orderId;

        const respB = await page.request.post(API_URL, {
            data: {
                action: 'submitGroupEnrollment',
                groupId: JOURNEY_GROUP,
                selections: [{ courseId: JOURNEY_NTD_B, mode: 'full', wantsLeader: false }],
            },
        });
        const resultB = await respB.json();
        expect(resultB.perCourse, `enrollment B failed: ${JSON.stringify(resultB)}`).toBeTruthy();
        expect(resultB.orderId).toBeTruthy();
        orderIdB = resultB.orderId;
    });

    test('S1: member sees pending_payment enrollment in my_courses', async ({ page }) => {
        await loginAs(page, 'member');
        await page.goto('/dashboard/my_courses');

        await expect(page.getByText('待繳費').first()).toBeVisible({ timeout: 10000 });
    });

    test('S2: member submits remittance on order A → order becomes remitted', async ({ page }) => {
        await loginAs(page, 'member');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitRemittanceInfo',
                orderId: orderIdA,
                bankCode: '808',
                last5: '77777',
                remittanceDate: '2026-07-06',
                note: '學員旅程測試',
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        const sb = getAdminClient();
        const { data: order } = await sb.from('orders')
            .select('status, remittance_bank_code')
            .eq('id', orderIdA).single();
        expect(order!.status).toBe('remitted');
        expect(order!.remittance_bank_code).toBe('808');
    });

    test('S3: member corrects remittance (更正匯款 on remitted order)', async ({ page }) => {
        await loginAs(page, 'member');

        const resp = await page.request.post(API_URL, {
            data: {
                action: 'submitRemittanceInfo',
                orderId: orderIdA,
                bankCode: '700',
                last5: '88888',
                remittanceDate: '2026-07-07',
            },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        const sb = getAdminClient();
        const { data: order } = await sb.from('orders')
            .select('status, remittance_bank_code, remittance_account_last5')
            .eq('id', orderIdA).single();
        expect(order!.status).toBe('remitted');
        expect(order!.remittance_bank_code).toBe('700');
        expect(order!.remittance_account_last5).toBe('88888');
    });

    test('S4: member cancels pending order B → enrollment cancelled + seat released', async ({ page }) => {
        await loginAs(page, 'member');
        const sb = getAdminClient();

        const { count: before } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', JOURNEY_NTD_B)
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']);

        const resp = await page.request.post(API_URL, {
            data: { action: 'cancelOrder', orderId: orderIdB },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        const { data: order } = await sb.from('orders')
            .select('status').eq('id', orderIdB).single();
        expect(order!.status).toBe('cancelled');

        const { data: enrollments } = await sb.from('enrollments')
            .select('status, cancel_reason')
            .eq('order_id', orderIdB);
        expect(enrollments!.length).toBeGreaterThan(0);
        expect(enrollments![0].status).toBe('cancelled');

        const { count: after } = await sb.from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', JOURNEY_NTD_B)
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']);
        expect(after!).toBeLessThan(before!);
    });
});
