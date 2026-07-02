import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Card Purchase flow
 * member buys 5 cards -> submits remittance -> admin approves -> balance increases
 * -> expiry date is visible on the active card pool
 *
 * Precondition: card_purchase_open must be 'true' in system_config.
 * We set it via admin settings UI at the start of the test.
 *
 * Note: card-purchase state accumulates across runs (delta assertion).
 */

test.describe('Card Purchase Flow', () => {
  test('member purchases cards, admin approves, balance increases, expiry shown', async ({ page }) => {
    // This test is longer due to the multi-step purchase+approval flow
    test.setTimeout(90_000);

    // ── Step 0: Admin opens the purchase window via system_config ──
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // Navigate to my_cards as member to check if purchase is open
    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');
    await page.waitForLoadState('networkidle');

    // Check if purchase button says "購買未開放"
    const purchaseButton = page.getByRole('button', { name: /立即購卡|購買未開放/ });
    await expect(purchaseButton).toBeVisible();
    const buttonText = await purchaseButton.textContent();

    if (buttonText?.includes('購買未開放')) {
      // Need to open purchase window via admin
      await page.context().clearCookies();
      await loginAs(page, 'admin');
      await page.goto('/admin/settings');
      await page.waitForLoadState('networkidle');

      await page.waitForTimeout(1000);

      const existingRow = page.locator('input[value="card_purchase_open"]');
      const exists = await existingRow.count();

      if (exists > 0) {
        const row = existingRow.locator('..').locator('..');
        const valueInput = row.locator('input').nth(1);
        await valueInput.fill('true');
      } else {
        const addButton = page.getByRole('button', { name: /新增|加入/ });
        if (await addButton.count() > 0) {
          await addButton.click();
          const keyInputs = page.locator('input[placeholder*="key"], input[placeholder*="Key"]');
          const lastKeyInput = keyInputs.last();
          await lastKeyInput.fill('card_purchase_open');
          const valueInputs = page.locator('input[placeholder*="value"], input[placeholder*="Value"]');
          const lastValueInput = valueInputs.last();
          await lastValueInput.fill('true');
        }
      }

      const saveButton = page.getByRole('button', { name: /儲存|更新|保存/ });
      if (await saveButton.count() > 0) {
        await saveButton.click();
        await page.waitForTimeout(2000);
      }

      // Switch back to member
      await page.context().clearCookies();
      await loginAs(page, 'member');
      await page.goto('/dashboard/my_cards');
      await page.waitForLoadState('networkidle');
    }

    // ── Step 1: Record initial balance ──
    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    // Get balance from the big number display
    const balanceElement = page.locator('.text-7xl, .text-8xl').first();
    let initialBalance = 0;
    if (await balanceElement.count() > 0) {
      const text = await balanceElement.textContent();
      initialBalance = parseInt(text?.trim() || '0', 10);
    }

    // ── Step 2: Member clicks "立即購卡" ──
    await page.getByRole('button', { name: '立即購卡' }).click();

    // Step 1 of purchase dialog: quantity selection
    await expect(page.getByText('購買堂卡')).toBeVisible();
    await expect(page.getByText('選擇購買數量')).toBeVisible();

    // Default quantity should be 5
    const qtyDisplay = page.locator('.text-5xl');
    await expect(qtyDisplay).toHaveText('5');

    // Click "下一步" to go to remittance info
    await page.getByRole('button', { name: '下一步' }).click();

    // Step 2: fill remittance info
    await expect(page.getByText('填寫匯款資訊')).toBeVisible();

    // Fill bank code
    const bankCodeInput = page.locator('input[placeholder*="822"]');
    await bankCodeInput.fill('822');

    // Fill last 5 digits
    const last5Input = page.locator('input[placeholder*="5 位"]');
    await last5Input.fill('12345');

    // Remittance date should be pre-filled (datetime-local), leave as is

    // Click "確認購買"
    await page.getByRole('button', { name: '確認購買' }).click();

    // Wait for success dialog
    await expect(page.getByText('訂單已建立')).toBeVisible({ timeout: 15000 });

    // Dismiss success dialog
    await page.getByRole('button', { name: '我知道了' }).click();
    await page.waitForTimeout(1000);

    // ── Step 3: Verify order appears in "未開通" tab ──
    await page.getByRole('tab', { name: /未開通/ }).click();
    await page.waitForTimeout(1000);

    // Should see a pending order with status "財務審核中" (remitted status)
    await expect(page.getByText('財務審核中').first()).toBeVisible();
    await expect(page.getByText('5 堂卡').first()).toBeVisible();

    // ── Step 4: Admin approves the order ──
    await page.context().clearCookies();
    await loginAs(page, 'admin');
    await page.goto('/leader/approvals');
    await page.waitForLoadState('networkidle');

    // Should be on "堂卡訂單" tab by default
    await expect(page.getByText('堂卡訂單').first()).toBeVisible();

    // Find the approve button near the E2E Member order.
    // Look for the card that contains "E2E Member" and has a "核准" button.
    const orderCards = page.locator('[class*="CardContent"]').filter({ hasText: 'E2E Member' }).filter({ hasText: '5 堂卡' });

    // Click the approve button on the first matching card
    if (await orderCards.count() > 0) {
      const approveBtn = orderCards.first().getByText('核准');
      await approveBtn.click();
    } else {
      // Fallback: find the row that contains E2E Member text and click its approve button
      const memberRow = page.locator('h3:has-text("E2E Member")').first().locator('..').locator('..').locator('..');
      await memberRow.locator('button:has-text("核准")').click();
    }

    // Wait for approval to process
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // ── Step 5: Verify member's balance increased ──
    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');
    await page.waitForLoadState('networkidle');

    // Go to 使用中 tab
    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(1000);

    // Check new balance
    const newBalanceElement = page.locator('.text-7xl, .text-8xl').first();
    await expect(newBalanceElement).toBeVisible();
    const newBalanceText = await newBalanceElement.textContent();
    const newBalance = parseInt(newBalanceText?.trim() || '0', 10);

    // Balance should have increased by 5
    expect(newBalance).toBe(initialBalance + 5);

    // ── Step 6: Verify FIFO expiry is displayed on the card pool ──
    // The "使用中" tab shows active (confirmed) orders. Each order card displays
    // the expiry date as "到期 YYYY-MM-DD" text. After approval, the newly
    // issued card pool should have an expiry date visible.
    // Card orders show "到期 YYYY" pattern in the active tab.
    const expiryText = page.locator('text=/到期 \\d{4}/');
    await expect(expiryText.first()).toBeVisible();
  });
});
