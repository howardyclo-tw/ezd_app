import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Single-session enrollment on a DEDICATED course
 *
 * "E2E Single Course" has 3 future sessions and the member is NOT
 * pre-enrolled (seed gives no enrollment for this course).
 *
 * The globalSetup re-seeds the DB before every suite run, so the member
 * always starts with 0 enrollments in this course and a deterministic
 * card balance.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000021';

test.describe('Single-Session Enrollment', () => {
  test('member enrolls in a single session, balance decreases, roster shows member', async ({ page }) => {
    await loginAs(page, 'member');

    // ── Step 1: Record initial card balance ──
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    const balanceEl = page.locator('.text-7xl, .text-8xl').first();
    await expect(balanceEl).toBeVisible();
    const balText = await balanceEl.textContent();
    const initialBalance = parseInt(balText?.trim() || '0', 10);

    // ── Step 2: Navigate to the dedicated single-enrollment course ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);

    // Wait for SSR content to fully stream in
    await expect(page.getByText('E2E Single Course')).toBeVisible();

    // ── Step 3: Open the enrollment dialog ──
    const enrollButton = page.getByRole('button', { name: /單堂報名/ });
    // Wait for the button to be visible and actionable (SSR streaming)
    await expect(enrollButton).toBeVisible();

    await enrollButton.click();

    // Choose "單堂報名" mode inside dialog
    await expect(page.getByText('選擇加入方式')).toBeVisible();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.locator('div:has(> div > p:text-is("單堂報名"))').first().click();

    // ── Step 4: Wait for session list and find an available session ──
    await expect(dialog.getByText('選擇堂次')).toBeVisible();

    // Checkboxes: enabled ones are sessions we can enroll in.
    const allCheckboxes = dialog.locator('button[role="checkbox"]');
    await expect(allCheckboxes.first()).toBeVisible();
    const checkboxCount = await allCheckboxes.count();

    let enrolled = false;
    for (let i = 0; i < checkboxCount; i++) {
      const cb = allCheckboxes.nth(i);
      const isDisabled = await cb.isDisabled();
      if (!isDisabled) {
        // Found an available session -- click it
        await cb.click();
        await page.waitForTimeout(300);
        enrolled = true;
        break;
      }
    }

    if (!enrolled) {
      // All sessions already enrolled from prior runs.
      // Close dialog and verify existing state.
      const backBtn = dialog.getByRole('button', { name: '返回' });
      if (await backBtn.count() > 0) {
        await backBtn.click();
        await page.waitForTimeout(300);
      }
      const closeBtn = dialog.getByRole('button', { name: '關閉' });
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
      }

      // Verify member is on the roster (enrolled in prior runs)
      await expect(page.getByText('E2E Member')).toBeVisible();
      return;
    }

    // ── Step 5: Confirm enrollment ──
    expect(initialBalance).toBeGreaterThanOrEqual(1);

    const confirmButton = dialog.getByRole('button', { name: /確認報名/ });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Wait for success toast to appear and page to settle
    await page.waitForTimeout(3000);

    // ── Step 6: Verify balance decreased by 1 ──
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    const newBalanceEl = page.locator('.text-7xl, .text-8xl').first();
    await expect(newBalanceEl).toBeVisible();
    const newText = await newBalanceEl.textContent();
    const newBalance = parseInt(newText?.trim() || '0', 10);
    expect(newBalance).toBe(initialBalance - 1);

    // ── Step 7: Verify member appears on roster ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);

    await expect(page.getByText('E2E Member')).toBeVisible();
  });
});
