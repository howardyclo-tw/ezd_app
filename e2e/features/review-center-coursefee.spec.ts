import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Feature test: Review Center -- course_fee payment tab
 *
 * Seed state (e2e/seed.sql):
 *   - "E2E NTD Course" (pricing_mode=ntd) under the E2E course group
 *   - Order ...0042: course_fee, status=remitted, amount=800, bank=012, last5=54321
 *   - Enrollment ...0062: pending_payment, linked to order ...0042
 *
 * Tests:
 *   HAPPY:  Admin opens review center, clicks the tab, sees the order, confirms it.
 *   ADVERSARIAL (a): Member calling confirmOrder via test API is rejected server-side.
 *   ADVERSARIAL (b): Guest calling cancelOrder on someone else's order is rejected.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY loaded from .env.local
 *       by playwright.config.ts (via @next/env).
 */

const COURSE_FEE_ORDER_ID = 'e2e00000-0000-0000-0000-000000000042';
const COURSE_FEE_ENROLLMENT_ID = 'e2e00000-0000-0000-0000-000000000062';

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return { url, key };
}

/** Helper: reset order to remitted + enrollment to pending_payment via Supabase REST */
async function resetSeedState(page: import('@playwright/test').Page) {
  const { url, key } = getSupabaseEnv();
  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=minimal',
  };

  // Reset enrollment first (FK dependency)
  await page.request.patch(
    `${url}/rest/v1/enrollments?id=eq.${COURSE_FEE_ENROLLMENT_ID}`,
    { headers, data: { status: 'pending_payment', cancel_reason: null, cancelled_at: null } }
  );

  // Reset order
  await page.request.patch(
    `${url}/rest/v1/orders?id=eq.${COURSE_FEE_ORDER_ID}`,
    { headers, data: { status: 'remitted', confirmed_by: null, confirmed_at: null } }
  );
}

/** Helper: query order+enrollment status via Supabase REST */
async function getDbState(page: import('@playwright/test').Page) {
  const { url, key } = getSupabaseEnv();
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  const [orderResp, enrollResp] = await Promise.all([
    page.request.get(`${url}/rest/v1/orders?id=eq.${COURSE_FEE_ORDER_ID}&select=status`, { headers }),
    page.request.get(`${url}/rest/v1/enrollments?id=eq.${COURSE_FEE_ENROLLMENT_ID}&select=status`, { headers }),
  ]);

  const [orderData, enrollData] = await Promise.all([orderResp.json(), enrollResp.json()]);
  return {
    orderStatus: (orderData as any[])[0]?.status as string,
    enrollmentStatus: (enrollData as any[])[0]?.status as string,
  };
}

test.describe('Review Center: Course Fee Payment Tab', () => {

  test('HAPPY: admin sees course_fee order details and confirms it', async ({ page }) => {
    test.setTimeout(90_000);

    // Reset seed state for idempotency
    await resetSeedState(page);

    await loginAs(page, 'admin');
    await page.goto('/leader/approvals');
    await page.waitForLoadState('networkidle');

    // Click the course fee tab
    await page.getByRole('tab', { name: '報名繳費' }).click();
    await page.waitForTimeout(1000);

    // Verify the seeded order is visible with correct details
    const orderCard = page.locator('[data-slot="card"]')
      .filter({ hasText: 'E2E Member' });
    await expect(orderCard).toBeVisible({ timeout: 10000 });

    // Verify order details: amount, remittance info
    await expect(orderCard.getByText('$800')).toBeVisible();
    await expect(orderCard.getByText('012')).toBeVisible();
    await expect(orderCard.getByText('54321')).toBeVisible();

    // Verify course group title
    await expect(orderCard.getByText('E2E H2 2026 Course Group')).toBeVisible();

    // Verify status badge shows remitted
    await expect(orderCard.getByText('已匯款')).toBeVisible();

    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept());

    // Click confirm
    const confirmBtn = orderCard.getByRole('button', { name: '確認' });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Wait for the action to complete and page to refresh
    await page.waitForTimeout(3000);

    // Verify the order is now confirmed
    await page.getByRole('tab', { name: '報名繳費' }).click();
    await page.waitForTimeout(1000);

    const updatedCard = page.locator('[data-slot="card"]')
      .filter({ hasText: 'E2E Member' });
    await expect(updatedCard.getByText('已確認')).toBeVisible({ timeout: 10000 });

    // Verify DB state: order=confirmed, enrollment=enrolled
    const state = await getDbState(page);
    expect(state.orderStatus).toBe('confirmed');
    expect(state.enrollmentStatus).toBe('enrolled');
  });

  test('ADVERSARIAL (a): member calling confirmOrder is rejected, order unchanged', async ({ page }) => {
    test.setTimeout(60_000);

    // Reset to remitted state
    await resetSeedState(page);

    // Login as member (non-admin)
    await loginAs(page, 'member');

    // Call confirmOrder via the e2e test API route (uses member's session cookies)
    const response = await page.request.post('http://[::1]:3000/api/e2e-test-actions', {
      data: { action: 'confirmOrder', orderId: COURSE_FEE_ORDER_ID },
    });

    const result = await response.json();

    // The action should reject: either success=false or an error message
    expect(result.success).not.toBe(true);

    // Verify DB state is unchanged
    const state = await getDbState(page);
    expect(state.orderStatus).toBe('remitted');
    expect(state.enrollmentStatus).toBe('pending_payment');
  });

  test('ADVERSARIAL (b): non-owner non-admin calling cancelOrder is rejected', async ({ page }) => {
    test.setTimeout(60_000);

    // Reset to remitted state
    await resetSeedState(page);

    // Login as guest (not the order owner, not admin)
    await loginAs(page, 'guest');

    // Call cancelOrder via the e2e test API route (uses guest's session cookies)
    const response = await page.request.post('http://[::1]:3000/api/e2e-test-actions', {
      data: { action: 'cancelOrder', orderId: COURSE_FEE_ORDER_ID },
    });

    const result = await response.json();

    // The action should reject: non-owner non-admin
    expect(result.success).not.toBe(true);

    // Verify DB state is unchanged
    const state = await getDbState(page);
    expect(state.orderStatus).toBe('remitted');
    expect(state.enrollmentStatus).toBe('pending_payment');
  });
});
