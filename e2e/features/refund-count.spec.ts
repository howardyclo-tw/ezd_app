import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Feature test: reviewSingleEnrollment refunds cards_per_session (not hard-coded 1)
 *
 * Seed state:
 *   - "E2E Multi-Card Course" has cards_per_session=2
 *   - E2E Member has a single enrollment (status=enrolled) on session 1
 *   - Order ...0041 has quantity=2, used=2 (reflecting the 2-card deduction)
 *   - Member card_balance = 10 (order ...0040: 10 remaining + order ...0041: 0 remaining)
 *
 * Test flow:
 *   1. Login as member, record initial card balance
 *   2. Login as admin, open review center, go to single enrollment tab
 *   3. Admin rejects the multi-card enrollment
 *   4. Login as member, assert card balance increased by 2 (NOT 1)
 *
 * Idempotent: if enrollment is already cancelled (prior run), the test
 * re-approves it first (which deducts 2 cards) then rejects it again.
 */

const MULTI_CARD_ENROLLMENT_ID = 'e2e00000-0000-0000-0000-000000000061';

test.describe('Refund Count: cards_per_session', () => {
  test('rejecting a single enrollment on a cards_per_session=2 course refunds 2 cards', async ({ page }) => {
    test.setTimeout(90_000);

    // ── Step 1: Login as member, record initial card balance ──
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();

    const balanceEl = page.locator('.text-7xl, .text-8xl').first();
    await expect(balanceEl).toBeVisible();
    const balText = await balanceEl.textContent();
    const initialBalance = parseInt(balText?.trim() || '0', 10);

    // ── Step 2: Login as admin, navigate to review center ──
    await page.context().clearCookies();
    await loginAs(page, 'admin');
    await page.goto('/leader/approvals');

    // Click the single enrollment tab
    await page.getByRole('tab', { name: '單堂報名' }).click();

    // ── Step 3: Find the multi-card course enrollment and handle state ──
    // Look for the "E2E Multi-Card Course" entry in the list
    const multiCardEntry = page.locator('div').filter({ hasText: 'E2E Multi-Card Course' }).first();
    await expect(multiCardEntry).toBeVisible({ timeout: 10000 });

    // Check if the enrollment is currently cancelled (from a prior test run)
    // If cancelled, we need to re-approve first, then reject
    const cancelledBadge = page.locator('div')
      .filter({ hasText: 'E2E Multi-Card Course' })
      .locator('span')
      .filter({ hasText: '已駁回' });

    const isCancelled = await cancelledBadge.count() > 0;

    if (isCancelled) {
      // Re-approve first (this deducts 2 cards, so balance goes down by 2)
      // Find the approve button near the multi-card entry
      // The card containing "E2E Multi-Card Course" should have a green approve button
      const card = page.locator('[data-slot="card"]')
        .filter({ hasText: 'E2E Multi-Card Course' });

      // Handle the confirm dialog
      page.on('dialog', dialog => dialog.accept());

      const approveButton = card.getByRole('button', { name: '核准' });
      await expect(approveButton).toBeVisible();
      await approveButton.click();
      // Wait for approve action to complete - button disappears after page refresh
      await expect(approveButton).not.toBeVisible({ timeout: 15000 });

      // Re-read the balance after re-approve (it decreased by 2)
      await page.context().clearCookies();
      await loginAs(page, 'member');
      await page.goto('/dashboard/my_cards');

      await page.getByRole('tab', { name: '使用中' }).click();

      const reBalanceEl = page.locator('.text-7xl, .text-8xl').first();
      await expect(reBalanceEl).toBeVisible();
      const reBalText = await reBalanceEl.textContent();
      const reApprovedBalance = parseInt(reBalText?.trim() || '0', 10);

      // Now switch back to admin and reject
      await page.context().clearCookies();
      await loginAs(page, 'admin');
      await page.goto('/leader/approvals');

      await page.getByRole('tab', { name: '單堂報名' }).click();

      const card2 = page.locator('[data-slot="card"]')
        .filter({ hasText: 'E2E Multi-Card Course' });

      const rejectButton = card2.getByRole('button', { name: '駁回' });
      await expect(rejectButton).toBeVisible({ timeout: 10000 });
      await rejectButton.click();
      // Wait for reject action to complete - button disappears after page refresh
      await expect(rejectButton).not.toBeVisible({ timeout: 15000 });

      // Verify balance increased by 2 from the re-approved state
      await page.context().clearCookies();
      await loginAs(page, 'member');
      await page.goto('/dashboard/my_cards');

      await page.getByRole('tab', { name: '使用中' }).click();

      const finalBalanceEl = page.locator('.text-7xl, .text-8xl').first();
      await expect(finalBalanceEl).toBeVisible();
      const finalText = await finalBalanceEl.textContent();
      const finalBalance = parseInt(finalText?.trim() || '0', 10);

      // After reject, balance should be reApprovedBalance + 2
      expect(finalBalance).toBe(reApprovedBalance + 2);
      return;
    }

    // ── Normal path: enrollment is currently "enrolled" ──
    // Set up dialog handler before clicking reject
    page.on('dialog', dialog => dialog.accept());

    const card = page.locator('[data-slot="card"]')
      .filter({ hasText: 'E2E Multi-Card Course' });

    const rejectButton = card.getByRole('button', { name: '駁回' });
    await expect(rejectButton).toBeVisible();
    await rejectButton.click();

    // Wait for reject action to complete - button disappears after page refresh
    await expect(rejectButton).not.toBeVisible({ timeout: 15000 });

    // ── Step 4: Login as member, verify balance increased by 2 ──
    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();

    const newBalanceEl = page.locator('.text-7xl, .text-8xl').first();
    await expect(newBalanceEl).toBeVisible();
    const newText = await newBalanceEl.textContent();
    const newBalance = parseInt(newText?.trim() || '0', 10);

    // Card balance should have increased by exactly 2 (cards_per_session for this course)
    expect(newBalance).toBe(initialBalance + 2);
  });
});
