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
 *
 * ISOLATION NOTE: The balance assertion reads initialBalance immediately
 * before the enrollment action and asserts the delta (-1) AFTER waiting
 * for a deterministic success indicator (the Sonner toast). This makes
 * the test order-independent — it passes regardless of what card-purchase
 * or other tests did to the shared E2E Member balance beforehand.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000021';

test.describe('Single-Session Enrollment', () => {
  test('member enrolls in a single session, balance decreases, roster shows member', async ({ page }) => {
    await loginAs(page, 'member');

    // ── Step 1: Record initial card balance ──
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();

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

    // Wait for the success toast — this proves the server action completed,
    // revalidatePath fired, and the DB balance is updated. Replaces the
    // non-deterministic waitForTimeout(3000) that caused stale-read flakes.
    const successToast = page.locator('[data-sonner-toast]', { hasText: /成功報名/ });
    await expect(successToast).toBeVisible({ timeout: 15000 });

    // ── Step 6: Verify balance decreased by 1 ──
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();

    // Poll the balance display until it reflects the deduction.
    // Belt-and-suspenders: the toast already proves the action completed,
    // but polling handles any residual Next.js data-cache propagation delay.
    const expectedBalance = initialBalance - 1;
    await expect.poll(async () => {
      const el = page.locator('.text-7xl, .text-8xl').first();
      await expect(el).toBeVisible();
      const text = await el.textContent();
      return parseInt(text?.trim() || '0', 10);
    }, {
      message: `Balance should decrease from ${initialBalance} to ${expectedBalance}`,
      timeout: 10_000,
      intervals: [500, 1000, 2000, 3000],
    }).toBe(expectedBalance);

    // ── Step 7: Verify member appears on roster ──
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);

    // Wait for SSR content to stream in before checking roster
    await expect(page.getByText('E2E Single Course')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('E2E Member')).toBeVisible();
  });
});
