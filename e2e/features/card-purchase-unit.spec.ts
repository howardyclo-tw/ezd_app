import { test, expect } from '@playwright/test';
import { getAdminClient } from '../fixtures/db';

/**
 * e2e: Card Purchase Unit — UI stepper enforcement
 *
 * Verifies that the UI stepper correctly enforces purchase-unit multiples:
 *   - Steps by the configured unit (default 5)
 *   - Cannot go below the unit (min button disabled)
 *
 * Server-side quantity validation logic (non-multiple rejection, zero,
 * negative, NaN) is covered by the pure validatePurchaseQuantity unit tests
 * in src/lib/card-purchase.test.ts — those are the authoritative coverage
 * for the server guard, not this e2e spec.
 */

test.describe('Card Purchase Unit — UI stepper enforcement', () => {
  const sb = getAdminClient();

  // Helper: upsert a system_config key
  async function setConfig(key: string, value: string) {
    const { error } = await sb.from('system_config').upsert(
      { key, value },
      { onConflict: 'key' },
    );
    if (error) throw new Error(`setConfig(${key}): ${error.message}`);
  }

  // Ensure card_purchase_unit = 5 and purchase is open
  test.beforeAll(async () => {
    await setConfig('card_purchase_unit', '5');
    await setConfig('card_purchase_open', 'true');
    await setConfig('card_purchase_mode', 'manual');
  });

  test.afterAll(async () => {
    // Restore defaults
    await setConfig('card_purchase_unit', '5');
  });

  test('UI stepper starts at unit, steps by unit, and enforces minimum', async ({ page }) => {
    // Login as member
    const { loginAs } = await import('../fixtures/auth');
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    // Open purchase dialog
    const purchaseButton = page.getByRole('button', { name: /購買堂卡/ });
    await expect(purchaseButton).toBeVisible({ timeout: 15000 });
    await purchaseButton.click();

    // The stepper should start at 5 (= unit) and step by 5.
    const qtyDisplay = page.locator('[data-testid="purchase-qty"]');
    await expect(qtyDisplay).toHaveText('5');

    // Increment: should go to 10
    const plusBtn = page.getByRole('button', { name: '' }).filter({ has: page.locator('.lucide-plus') });
    await plusBtn.click();
    await expect(qtyDisplay).toHaveText('10');

    // Decrement: should go back to 5
    const minusBtn = page.getByRole('button', { name: '' }).filter({ has: page.locator('.lucide-minus') });
    await minusBtn.click();
    await expect(qtyDisplay).toHaveText('5');

    // Cannot go below unit (5): minus button should be disabled
    await expect(minusBtn).toBeDisabled();
  });

  test('UI stepper prevents zero/negative via disabled min button', async ({ page }) => {
    const { loginAs } = await import('../fixtures/auth');
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    await page.getByRole('button', { name: /購買堂卡/ }).click();
    await expect(page.getByRole('heading', { name: '購買堂卡' })).toBeVisible();

    const qtyDisplay = page.locator('[data-testid="purchase-qty"]');
    await expect(qtyDisplay).toHaveText('5');

    // Minus button should be disabled at the minimum (unit=5)
    const minusBtn = page.getByRole('button', { name: '' }).filter({ has: page.locator('.lucide-minus') });
    await expect(minusBtn).toBeDisabled();

    // Cannot reach 0 or negative via UI stepper
  });
});
