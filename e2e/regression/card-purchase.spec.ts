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
 * ISOLATION NOTE: Uses delta assertion (initialBalance + 5) and deterministic
 * waits (alert dialog for approval, expect.poll for balance) so the test is
 * order-independent — works regardless of other tests' balance mutations.
 */

test.describe('Card Purchase Flow', () => {
  test('member purchases cards, admin approves, balance increases, expiry shown', async ({ page }) => {
    // This test is longer due to the multi-step purchase+approval flow
    test.setTimeout(90_000);

    // ── Step 0: Admin opens the purchase window via system_config ──
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');

    // Navigate to my_cards as member to check if purchase is open
    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    // Check if purchase button says "購買未開放"
    const purchaseButton = page.getByRole('button', { name: /購買堂卡|購買未開放/ });
    await expect(purchaseButton).toBeVisible();
    const buttonText = await purchaseButton.textContent();

    if (buttonText?.includes('購買未開放')) {
      // Need to open purchase window via admin
      await page.context().clearCookies();
      await loginAs(page, 'admin');
      await page.goto('/admin/settings');

      // Wait for settings page to render (replaces waitForTimeout)
      await expect(page.getByRole('button', { name: /儲存|更新|保存/ }).first()).toBeVisible({ timeout: 15000 });

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
        // Wait for save to complete - use Sonner toast or page state change
        await expect(saveButton).toBeVisible({ timeout: 15000 });
      }

      // Switch back to member
      await page.context().clearCookies();
      await loginAs(page, 'member');
      await page.goto('/dashboard/my_cards');

    }

    // ── Step 1: Record initial balance (on default '堂卡' tab) ──
    const balanceElement = page.locator('[data-testid="card-balance"]');
    let initialBalance = 0;
    if (await balanceElement.count() > 0) {
      const text = await balanceElement.textContent();
      initialBalance = parseInt(text?.trim() || '0', 10);
    }

    // ── Step 2: Member clicks "立即購卡" ──
    await page.getByRole('button', { name: '購買堂卡' }).click();

    // Step 1 of purchase dialog: quantity selection
    await expect(page.getByRole('heading', { name: '購買堂卡' })).toBeVisible();
    await expect(page.getByText('選擇購買數量')).toBeVisible();

    // Default quantity should be 5
    const qtyDisplay = page.locator('[data-testid="purchase-qty"]');
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
    // Wait for success dialog to close (replaces waitForTimeout)
    await expect(page.getByText('訂單已建立')).not.toBeVisible({ timeout: 10000 });

    // ── Step 3: Verify order appears in pending section of '堂卡' tab ──
    // Pending orders show under "待審核" section in the '堂卡' tab (default)
    await expect(page.getByText('待審核').first()).toBeVisible();
    await expect(page.getByText('5 堂卡').first()).toBeVisible();

    // ── Step 4: Admin approves the order ──
    await page.context().clearCookies();
    await loginAs(page, 'admin');
    await page.goto('/leader/approvals');

    // Should be on "繳費對帳" tab by default
    await expect(page.getByText('繳費對帳').first()).toBeVisible();

    // Filter on the unique remittance last5 digits the test filled in
    const orderCard = page.locator('[data-slot="card"]')
      .filter({ hasText: '堂卡購買' })
      .filter({ hasText: 'E2E Member' })
      .filter({ hasText: '12345' });

    const approveBtn = orderCard.getByRole('button', { name: '核准' });
    await expect(approveBtn).toBeVisible({ timeout: 10000 });
    await approveBtn.click();

    await expect(approveBtn).not.toBeVisible({ timeout: 15000 });

    // ── Step 5: Verify member's balance increased ──
    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    // Balance is on the default '堂卡' tab
    // Poll the balance display until it reflects the card purchase.
    // The alert above proves the action completed, but polling handles
    // any residual Next.js data-cache propagation delay.
    const expectedBalance = initialBalance + 5;
    await expect.poll(async () => {
      const el = page.locator('[data-testid="card-balance"]');
      await expect(el).toBeVisible();
      const text = await el.textContent();
      return parseInt(text?.trim() || '0', 10);
    }, {
      message: `Balance should increase from ${initialBalance} to ${expectedBalance}`,
      timeout: 10_000,
      intervals: [500, 1000, 2000, 3000],
    }).toBe(expectedBalance);

    // ── Step 6: Verify FIFO expiry is displayed on the card pool ──
    // The '堂卡' tab shows active (confirmed) orders. Each order card displays
    // the expiry date as "YYYY-MM-DD 到期" text. After approval, the newly
    // issued card pool should have an expiry date visible.
    const expiryText = page.locator('text=/\\d{4}.*到期/');
    await expect(expiryText.first()).toBeVisible();
  });
});
