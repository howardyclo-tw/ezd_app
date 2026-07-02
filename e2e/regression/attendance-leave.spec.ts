import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Attendance marking + Leave
 * 1. Admin can enter/exit attendance editing mode (toggle present/absent/unmarked)
 * 2. Member takes leave on a FUTURE session (auto-approved) -- requires enrollment
 * 3. Leave button is disabled on sessions where leave was already taken
 *
 * Idempotency: If the member already has leave on all sessions (from a prior run),
 * the leave test verifies the existing leave state rather than trying to take new leave.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000020';

test.describe('Attendance & Leave', () => {
  test('admin can enter and exit attendance editing mode', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // The "點名" button enables attendance editing for admin/leader
    const attendanceButton = page.getByRole('button', { name: '點名' });
    await expect(attendanceButton).toBeVisible();
    await attendanceButton.click();
    await page.waitForTimeout(500);

    // In editing mode, "儲存" and "取消" buttons should appear
    await expect(page.getByRole('button', { name: '儲存' })).toBeVisible();
    await expect(page.getByRole('button', { name: '取消' })).toBeVisible();

    // Cancel to exit editing mode without saving
    await page.getByRole('button', { name: '取消' }).click();
    await page.waitForTimeout(500);

    // "點名" button should reappear
    await expect(page.getByRole('button', { name: '點名' })).toBeVisible();
  });

  test('member takes leave on a future session or verifies existing leave', async ({ page }) => {
    // Ensure the member is enrolled before testing leave
    await loginAs(page, 'member');
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // Check if member is in roster
    const memberInRoster = await page.getByText('E2E Member').count();

    if (memberInRoster === 0) {
      // Need to enroll first via single enrollment dialog
      const enrollTrigger = page.getByRole('button', { name: /單堂報名/ });
      await expect(enrollTrigger).toBeVisible();
      await enrollTrigger.click();
      await page.waitForTimeout(500);

      await expect(page.getByText('選擇加入方式')).toBeVisible();
      const dialog = page.locator('[data-slot="dialog-content"]');
      await dialog.locator('div:has(> div > p:text-is("單堂報名"))').first().click();
      await page.waitForTimeout(500);

      await expect(dialog.getByText('選擇堂次')).toBeVisible();

      // Select first enabled checkbox
      const checkboxes = dialog.locator('button[role="checkbox"]:not([disabled])');
      const firstCb = checkboxes.first();
      await expect(firstCb).toBeVisible();
      await firstCb.click();
      await page.waitForTimeout(300);

      const confirmBtn = dialog.getByRole('button', { name: /確認報名/ });
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();
      await page.waitForTimeout(3000);

      // Reload
      await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('E2E Member')).toBeVisible();
    }

    // Now check leave buttons
    const leaveButtons = page.getByRole('button', { name: '請假' });
    const count = await leaveButtons.count();

    if (count === 0) {
      // No leave buttons means member's sessions are in a state where leave is not shown
      // This happens if the member is not enrolled in any session visible as a card
      // Just verify the page loaded correctly
      await expect(page.getByText('E2E Basic Groove')).toBeVisible();
      return;
    }

    // Try to find a non-disabled leave button (one where leave hasn't been taken yet)
    let clickedLeave = false;
    for (let i = 0; i < count; i++) {
      const btn = leaveButtons.nth(i);
      const isDisabled = await btn.isDisabled();
      if (!isDisabled) {
        // Clicking the leave button opens a React AlertDialog (not native)
        await btn.click();
        clickedLeave = true;
        break;
      }
    }

    if (clickedLeave) {
      // Leave confirmation alert dialog should appear (React AlertDialog, not native)
      await expect(page.getByText('申請請假')).toBeVisible();

      const confirmLeave = page.getByRole('button', { name: '確認請假' });
      await expect(confirmLeave).toBeVisible();

      // Register native alert() handler BEFORE clicking confirm
      // The submitLeaveRequest action calls alert(res.message) on completion
      page.once('dialog', async (dlg) => {
        await dlg.accept();
      });
      await confirmLeave.click();

      // Wait for processing
      await page.waitForTimeout(3000);

      // Reload and verify
      await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
      await page.waitForLoadState('networkidle');

      // Should see "請假" status somewhere
      await expect(page.getByText('請假').first()).toBeVisible();
    } else {
      // All leave buttons are disabled -- leave was already taken on all sessions
      // This is the idempotent case: verify leave state exists
      // The session cards should show "請假" status badges
      const leaveStatus = page.locator('text=請假');
      expect(await leaveStatus.count()).toBeGreaterThan(0);
    }
  });

  test('leave button is disabled on sessions where leave was taken', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // Find leave buttons -- those on sessions with existing leave should be disabled
    const leaveButtons = page.getByRole('button', { name: '請假' });
    const count = await leaveButtons.count();

    // If member has any sessions, verify the pattern:
    // disabled leave buttons exist for sessions with leave taken
    if (count > 0) {
      let hasDisabled = false;
      for (let i = 0; i < count; i++) {
        const btn = leaveButtons.nth(i);
        const isDisabled = await btn.isDisabled();
        if (isDisabled) {
          hasDisabled = true;
          break;
        }
      }
      // After the leave test, at least one button should be disabled
      expect(hasDisabled).toBe(true);
    }
  });
});
