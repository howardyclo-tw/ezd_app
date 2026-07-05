import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient } from '../fixtures/db';

/**
 * Admin journey: dual-role walkthrough (5R.8)
 *
 * 幹部登入 → 繳費對帳看到分組訂單 → 確認一筆(報名轉成立)
 * → 名冊看到成立學員 → 驗證 pending 徽章
 */

const COURSE_GROUP_TITLE = 'E2E H2 2026 Course Group';
const COURSE_FEE_ORDER = 'e2e00000-0000-0000-0000-000000000042';
const NTD_COURSE_ID = 'e2e00000-0000-0000-0000-000000000023';
const NTD_PENDING_ENROLLMENT = 'e2e00000-0000-0000-0000-000000000062';
const COURSE_GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';

test.describe.serial('Admin journey (5R.8)', () => {
    test('J1: admin sees grouped payment orders in 繳費對帳', async ({ page }) => {
        await loginAs(page, 'admin');
        await page.goto('/leader/approvals');

        // Verify group header is visible
        await expect(page.getByText(COURSE_GROUP_TITLE)).toBeVisible({ timeout: 10000 });

        // Verify the seed courseFee order card is visible
        const orderCard = page.locator('[data-slot="card"]')
            .filter({ hasText: 'E2E Member' })
            .filter({ hasText: '報名繳費' })
            .filter({ hasText: '54321' });
        await expect(orderCard).toBeVisible();

        // Verify order amount
        await expect(orderCard.getByText('$800')).toBeVisible();

        // Verify remittance info box is shown
        await expect(orderCard.getByText('012')).toBeVisible();
        await expect(orderCard.getByText('54321')).toBeVisible();
    });

    test('J2: admin confirms courseFee order → enrollment becomes enrolled', async ({ page }) => {
        await loginAs(page, 'admin');
        const sb = getAdminClient();

        // Pre-check: enrollment is pending_payment
        const { data: before } = await sb.from('enrollments')
            .select('status').eq('id', NTD_PENDING_ENROLLMENT).single();
        expect(before!.status).toBe('pending_payment');

        // Confirm order via test API
        const resp = await page.request.post('http://[::1]:3000/api/e2e-test-actions', {
            data: { action: 'confirmOrder', orderId: COURSE_FEE_ORDER },
        });
        const result = await resp.json();
        expect(result.success).toBe(true);

        // Post-check: enrollment is now enrolled
        const { data: after } = await sb.from('enrollments')
            .select('status').eq('id', NTD_PENDING_ENROLLMENT).single();
        expect(after!.status).toBe('enrolled');

        // Order is confirmed
        const { data: order } = await sb.from('orders')
            .select('status').eq('id', COURSE_FEE_ORDER).single();
        expect(order!.status).toBe('confirmed');
    });

    test('J3: admin sees enrolled student on course roster', async ({ page }) => {
        await loginAs(page, 'admin');

        await page.goto(`/courses/groups/${COURSE_GROUP_ID}/${NTD_COURSE_ID}`);
        await page.waitForURL(`**/courses/groups/**`, { timeout: 15000 });

        await expect(page.getByRole('heading', { name: /E2E NTD Course/ })).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('E2E Member')).toBeVisible({ timeout: 10000 });
    });
});
