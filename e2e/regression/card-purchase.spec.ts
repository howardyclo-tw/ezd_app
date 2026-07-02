import { test, expect, Page } from '@playwright/test';
import { loginAs, ACCOUNTS } from '../fixtures/auth';

/**
 * Regression baseline: Card Purchase flow
 * member buys 5 cards -> submits remittance -> admin approves -> balance increases
 *
 * Precondition: card_purchase_open must be 'true' in system_config.
 * We set it via admin settings UI at the start of the test.
 */

// Shared IDs from seed
const COURSE_GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';

test.describe('Card Purchase Flow', () => {
  test('member purchases cards, admin approves, balance increases', async ({ page }) => {
    // ── Step 0: Admin opens the purchase window via system_config ──
    await loginAs(page, 'admin');
    await page.goto('/admin/settings');
    await page.waitForLoadState('networkidle');

    // The system config page has key-value rows. We need to ensure
    // card_purchase_open = true. Find or create the entry.
    // The admin settings page uses SystemConfigClient which renders editable rows.
    // Let's check if the key already exists and set it.
    // Use Supabase MCP to set config directly for reliability.
    // Actually, let's just navigate to settings and handle it via the UI.
    // But actually, the simplest reliable approach: insert via the app's own
    // updateSystemConfig action. Since we're already admin, let's use the
    // settings page.

    // The SystemConfigClient renders a table of key-value pairs with edit buttons.
    // Let's just use page.evaluate to call the server action directly:
    // Actually we can't call server actions from page.evaluate.
    // Let's use the admin settings UI. Read the component to find selectors.

    // For maximum reliability, set the system_config via direct SQL through
    // Supabase. But we don't have that in the test. Let's use the UI.
    // Actually, the task says "prefer whatever is reliable" -- let's just
    // navigate and use the UI. But first let me check the SystemConfigClient.
    // I'll take the simplest approach: use page.request to hit the API,
    // but this app has no API routes (server actions only).
    //
    // Simplest reliable approach: the test will proceed under the assumption
    // that card_purchase_open is already 'true' (set by seed or previous test).
    // If the button shows "購買未開放" we'll set it via the settings page.

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

      // The SystemConfigClient has a form. We need to find the card_purchase_open row
      // and set it to 'true'. The component renders a list of key-value entries.
      // Let's look at what the settings page renders.
      // We'll try to find and edit the card_purchase_open field.
      // If it doesn't exist, we'll add it.

      // Wait for the settings content
      await page.waitForTimeout(1000);

      // The settings page may have an "add" button and editable rows.
      // Let's try a different approach: fill the form fields.
      // Actually, the simplest way: let's just check if the key input exists
      // with value card_purchase_open and set value to true.

      // The SystemConfigClient renders rows with key inputs and value inputs.
      // Let's find the row with card_purchase_open or add a new one.
      const existingRow = page.locator('input[value="card_purchase_open"]');
      const exists = await existingRow.count();

      if (exists > 0) {
        // Find the corresponding value input and set it
        const row = existingRow.locator('..').locator('..'); // parent row
        const valueInput = row.locator('input').nth(1);
        await valueInput.fill('true');
      } else {
        // Click add button and fill in
        const addButton = page.getByRole('button', { name: /新增|加入/ });
        if (await addButton.count() > 0) {
          await addButton.click();
          // Fill key and value
          const keyInputs = page.locator('input[placeholder*="key"], input[placeholder*="Key"]');
          const lastKeyInput = keyInputs.last();
          await lastKeyInput.fill('card_purchase_open');
          const valueInputs = page.locator('input[placeholder*="value"], input[placeholder*="Value"]');
          const lastValueInput = valueInputs.last();
          await lastValueInput.fill('true');
        }
      }

      // Save
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
    // The balance is displayed as a large number in the card
    const balanceText = await page.locator('text=目前的總剩餘堂數').locator('..').locator('..').locator('p').first().textContent();
    // Navigate to "使用中" tab to see balance
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

    // Find the order from E2E Member and click "核准"
    const memberOrderCard = page.locator('text=E2E Member').first().locator('..').locator('..').locator('..');

    // Find the approve button near the E2E Member order
    // The approve button has text "核准"
    const approveButtons = page.locator('button:has-text("核准")');
    // We need to find the one associated with E2E Member's order
    // Look for the card that contains "E2E Member" and has a "核准" button
    const orderCards = page.locator('[class*="CardContent"]').filter({ hasText: 'E2E Member' }).filter({ hasText: '5 堂卡' });

    // Click the approve button on the first matching card
    if (await orderCards.count() > 0) {
      const approveBtn = orderCards.first().getByText('核准');
      await approveBtn.click();
    } else {
      // Fallback: find any order with "E2E Member" text and click its approve button
      // The card structure: Card > CardContent > [left side] [right side with buttons]
      // Find the row that contains E2E Member
      const memberRow = page.locator('h3:has-text("E2E Member")').first().locator('..').locator('..').locator('..');
      await memberRow.locator('button:has-text("核准")').click();
    }

    // Wait for page to refresh after approval
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');

    // Verify the order now shows "已核准" badge
    // The status should have changed - let's verify by checking the member's balance
    // Note: page may have refreshed and the order may have moved or changed status

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
  });
});
