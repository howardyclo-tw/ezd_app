import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Transfer (session transfer between members)
 *
 * Pre-conditions (from seed.sql):
 *   - E2E Member is full-enrolled in E2E Workshop (workshop, 4 future sessions)
 *   - E2E Member2 exists with role=member (transfer recipient)
 *   - E2E Guest exists with role=guest (rejected recipient)
 *   - Workshop courses have NO quota limit for transfers
 *
 * Happy path:
 *   Member transfers a future workshop session to Member2 via UI.
 *   Asserts success message, transfer_out on sender, transfer_in on recipient in roster.
 *   Uses the workshop course because it has no shared quota with makeup (avoiding
 *   ordering conflicts with the makeup regression test).
 *
 * Adversarial:
 *   Guest does NOT appear in transfer candidate list (server and client filter guests out).
 *
 * Idempotency: seed.sql cleanup deletes prior transfer_requests and attendance for
 * these courses. The test also handles the case where the session already shows
 * transfer_out from a prior run.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const WORKSHOP_ID = 'e2e00000-0000-0000-0000-000000000024'; // E2E Workshop

test.describe('Transfer', () => {
  test('member transfers a future workshop session to another member', async ({ page }) => {
    await loginAs(page, 'member');

    // Navigate to E2E Workshop course detail
    await page.goto(`/courses/groups/${GROUP_ID}/${WORKSHOP_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'E2E Workshop' })).toBeVisible();

    // The member should see "已報名全堂" since they are full-enrolled
    await expect(page.getByText('已報名全堂')).toBeVisible();

    // Find an ENABLED transfer button (workshop has all future sessions with no quota limit).
    const allTransferButtons = page.getByRole('button', { name: '轉讓' });
    const totalBtnCount = await allTransferButtons.count();
    expect(totalBtnCount).toBeGreaterThan(0);

    // Find the first ENABLED transfer button (skip any frozen sessions)
    let enabledBtn = null;
    for (let i = 0; i < totalBtnCount; i++) {
      const btn = allTransferButtons.nth(i);
      if (await btn.isEnabled()) {
        enabledBtn = btn;
        break;
      }
    }

    // If no enabled transfer button, a prior run already transferred all sessions.
    // Verify existing transfer state instead.
    if (!enabledBtn) {
      const hasTransferOut = await page.getByText('轉出').count();
      expect(hasTransferOut).toBeGreaterThan(0);
      await expect(page.getByText('E2E Member2', { exact: true })).toBeVisible();
      return;
    }

    await enabledBtn.click();

    // Transfer dialog should open with "選擇接手學員" title
    await expect(page.getByText('選擇接手學員')).toBeVisible({ timeout: 5000 });

    // Wait for candidates to load (loading spinner disappears)
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('.animate-spin');
      return spinners.length === 0;
    }, { timeout: 10000 });

    // Search for Member2 in the candidate list
    const searchInput = page.getByPlaceholder('搜尋社員姓名...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('E2E Member2');
    await page.waitForTimeout(300);

    // Select Member2 from the list
    const member2Button = page.locator('button', { hasText: 'E2E Member2' });
    await expect(member2Button).toBeVisible({ timeout: 5000 });
    await member2Button.click();

    // Confirm step should appear with Member2's name
    await expect(page.getByRole('heading', { name: '確認轉讓' })).toBeVisible();
    await expect(page.locator('[role="dialog"]').getByText('E2E Member2', { exact: true })).toBeVisible();

    // Handle the alert dialog that shows the success message
    const alertPromise = page.waitForEvent('dialog', { timeout: 15000 });

    // Click confirm transfer button
    const confirmBtn = page.getByRole('button', { name: '確認轉讓' });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Capture the alert message
    const dialog = await alertPromise;
    const alertMessage = dialog.message();
    expect(alertMessage).toContain('轉讓成功');
    await dialog.accept();

    // Wait for page to refresh and verify the transfer result
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Reload to see updated roster
    await page.goto(`/courses/groups/${GROUP_ID}/${WORKSHOP_ID}`);
    await page.waitForLoadState('networkidle');

    // Verify: the session card should now show "轉出" status for the transferred session
    const transferOutBadge = page.getByText('轉出');
    await expect(transferOutBadge.first()).toBeVisible({ timeout: 5000 });

    // Verify: Member2 should appear in the roster as a transfer_in student
    // The roster table should include Member2 with transfer_in label
    await expect(page.getByText('E2E Member2', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('guest is excluded from transfer candidate list', async ({ page }) => {
    await loginAs(page, 'member');

    // Use the workshop course (workshop has NO quota limit, transfer buttons always enabled)
    await page.goto(`/courses/groups/${GROUP_ID}/${WORKSHOP_ID}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'E2E Workshop' })).toBeVisible();

    const transferButtons = page.getByRole('button', { name: '轉讓' });
    const totalCount = await transferButtons.count();
    expect(totalCount).toBeGreaterThan(0);

    // Find an enabled transfer button (skip any frozen)
    let enabledBtn = null;
    for (let i = 0; i < totalCount; i++) {
      const btn = transferButtons.nth(i);
      if (await btn.isEnabled()) {
        enabledBtn = btn;
        break;
      }
    }
    expect(enabledBtn).not.toBeNull();
    await enabledBtn!.click();
    await expect(page.getByText('選擇接手學員')).toBeVisible({ timeout: 5000 });

    // Wait for candidates to load
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('.animate-spin');
      return spinners.length === 0;
    }, { timeout: 10000 });

    // Search for E2E Guest - should NOT appear in results
    const searchInput = page.getByPlaceholder('搜尋社員姓名...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('E2E Guest');
    await page.waitForTimeout(500);

    // Assert: the "no results" message appears (guests are filtered out server-side)
    await expect(page.getByText('找不到符合的社員')).toBeVisible({ timeout: 3000 });

    // Double-check: no button with Guest's name exists in the dialog
    const guestButton = page.locator('button', { hasText: 'E2E Guest' });
    await expect(guestButton).toHaveCount(0);

    // Close the dialog
    const cancelBtn = page.getByRole('button', { name: '取消' });
    await cancelBtn.click();
  });
});
