import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Single-session enrollment
 * member enrolls in one future session -> balance decreases by cards_per_session (1)
 * -> roster shows the member
 *
 * Idempotency: If the member is already enrolled in all sessions, the test
 * verifies the enrollment state without re-enrolling. On first run, it enrolls.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000020';

test.describe('Single-Session Enrollment', () => {
  test('member enrolls in a single session, balance decreases, roster shows member', async ({ page }) => {
    await loginAs(page, 'member');

    // ── Step 1: Record initial card balance ──
    await page.goto('/dashboard/my_cards');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    const balanceEl = page.locator('.text-7xl, .text-8xl').first();
    let initialBalance = 0;
    if (await balanceEl.count() > 0) {
      const text = await balanceEl.textContent();
      initialBalance = parseInt(text?.trim() || '0', 10);
    }

    // ── Step 2: Navigate to the course detail page ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // Verify we're on the right course
    await expect(page.getByText('E2E Basic Groove')).toBeVisible();

    // ── Step 3: Check if member is already enrolled ──
    const memberInRoster = await page.getByText('E2E Member').count();

    if (memberInRoster > 0) {
      // Member is already enrolled from a previous run -- verify state
      // The roster should contain E2E Member
      await expect(page.getByText('E2E Member')).toBeVisible();

      // Verify the enrollment dialog shows sessions as "已在名單"
      const enrollButton = page.getByRole('button', { name: /單堂報名/ });
      await expect(enrollButton).toBeVisible();
      await enrollButton.click();
      await page.waitForTimeout(500);

      await expect(page.getByText('選擇加入方式')).toBeVisible();

      const dialog = page.locator('[data-slot="dialog-content"]');
      await dialog.locator('div:has(> div > p:text-is("單堂報名"))').first().click();
      await page.waitForTimeout(500);

      // Verify sessions show "已在名單"
      await expect(dialog.getByText('已在名單').first()).toBeVisible();

      // Close dialog
      await dialog.getByRole('button', { name: '返回' }).click();
      await page.waitForTimeout(300);
      await dialog.getByRole('button', { name: '關閉' }).click();
      return;
    }

    // ── Step 4: Member is not enrolled yet -- proceed with enrollment ──
    expect(initialBalance).toBeGreaterThanOrEqual(1);

    const enrollButton = page.getByRole('button', { name: /單堂報名/ });
    await expect(enrollButton).toBeVisible();
    await enrollButton.click();

    // Choose "單堂報名" mode inside dialog
    await expect(page.getByText('選擇加入方式')).toBeVisible();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.locator('div:has(> div > p:text-is("單堂報名"))').first().click();

    // ── Step 5: Select the first available future session ──
    await expect(dialog.getByText('選擇堂次')).toBeVisible();

    // Click the first enabled checkbox
    const sessionCheckboxes = dialog.locator('button[role="checkbox"]:not([disabled])');
    const firstCheckbox = sessionCheckboxes.first();
    await expect(firstCheckbox).toBeVisible();
    await firstCheckbox.click();
    await page.waitForTimeout(300);

    // ── Step 6: Click "確認報名" ──
    const confirmButton = dialog.getByRole('button', { name: /確認報名/ });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Wait for success toast
    await page.waitForTimeout(3000);

    // ── Step 7: Verify balance decreased ──
    await page.goto('/dashboard/my_cards');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    const newBalanceEl = page.locator('.text-7xl, .text-8xl').first();
    if (await newBalanceEl.count() > 0) {
      const newText = await newBalanceEl.textContent();
      const newBalance = parseInt(newText?.trim() || '0', 10);
      // Balance should have decreased by 1 (cards_per_session = 1)
      expect(newBalance).toBe(initialBalance - 1);
    }

    // ── Step 8: Verify member appears on roster ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Member')).toBeVisible();
  });
});
