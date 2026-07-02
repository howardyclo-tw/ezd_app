import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Single-session enrollment on a DEDICATED course
 *
 * "E2E Single Course" has 3 future sessions and the member is NOT
 * pre-enrolled (seed gives no enrollment for this course).
 *
 * On first run: picks the first un-enrolled session, performs a real
 * single-session enrollment via SessionEnrollmentDialog, and asserts
 * balance decreased by cards_per_session (1) and the roster shows
 * the member.
 *
 * Re-runnability: picks the first session that does NOT show "已在名單".
 * With 3 sessions the test can run 3 times before exhaustion; after that
 * it verifies the enrolled state (all sessions show "已在名單") and passes.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000021';

test.describe('Single-Session Enrollment', () => {
  test('member enrolls in a single session, balance decreases, roster shows member', async ({ page }) => {
    await loginAs(page, 'member');

    // ── Step 1: Record initial card balance ──
    await page.goto('/dashboard/my_cards');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    const balanceEl = page.locator('.text-7xl, .text-8xl').first();
    await expect(balanceEl).toBeVisible();
    const balText = await balanceEl.textContent();
    const initialBalance = parseInt(balText?.trim() || '0', 10);

    // ── Step 2: Navigate to the dedicated single-enrollment course ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // Verify we are on the right course
    await expect(page.getByText('E2E Single Course')).toBeVisible();

    // ── Step 3: Open the enrollment dialog ──
    const enrollButton = page.getByRole('button', { name: /單堂報名/ });
    // If the button does not exist the member is already full-enrolled in all
    // sessions (cannot happen for this course by design, but guard anyway).
    const enrollBtnCount = await enrollButton.count();
    if (enrollBtnCount === 0) {
      // All sessions are enrolled -- verify the enrolled badge
      await expect(page.getByText('已報名全堂')).toBeVisible();
      // Verify member is on the roster
      await expect(page.getByText('E2E Member')).toBeVisible();
      return;
    }

    await enrollButton.click();

    // Choose "單堂報名" mode inside dialog
    await expect(page.getByText('選擇加入方式')).toBeVisible();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await dialog.locator('div:has(> div > p:text-is("單堂報名"))').first().click();

    // ── Step 4: Wait for session list and find an available session ──
    await expect(dialog.getByText('選擇堂次')).toBeVisible();

    // Checkboxes: enabled ones are sessions we can enroll in.
    // Disabled+checked ones are "已在名單" (from prior runs).
    const allCheckboxes = dialog.locator('button[role="checkbox"]');
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
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: '使用中' }).click();
    await page.waitForTimeout(500);

    const newBalanceEl = page.locator('.text-7xl, .text-8xl').first();
    await expect(newBalanceEl).toBeVisible();
    const newText = await newBalanceEl.textContent();
    const newBalance = parseInt(newText?.trim() || '0', 10);
    expect(newBalance).toBe(initialBalance - 1);

    // ── Step 7: Verify member appears on roster ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('E2E Member')).toBeVisible();
  });
});
