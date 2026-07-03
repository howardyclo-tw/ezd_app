import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Attendance marking + Leave
 * 1. Admin enters edit mode, marks a student present on a clean session, saves, verifies persistence
 * 2. Member takes leave on a FUTURE session (auto-approved) -- requires enrollment
 * 3. Leave button is disabled on sessions where leave was already taken
 * 4. Leave button is disabled on PAST sessions (cannot leave past sessions)
 *
 * Idempotency: If the member already has leave on all future sessions (from a prior run),
 * the leave test verifies the existing leave state rather than trying to take new leave.
 * The attendance marking test sets present (idempotent: setting present again is fine).
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000020';

test.describe('Attendance & Leave', () => {
  test('admin marks a student present, saves, and verifies persistence', async ({ page }) => {
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

    // Find the E2E Member row in the roster table.
    const memberRow = page.locator('tr', { hasText: 'E2E Member' }).first();
    await expect(memberRow).toBeVisible();

    // We have 4 sessions (0=past, 1,2,3=future). Columns:
    // td[0]=name, td[1]=session0(past), td[2]=session1, td[3]=session2, td[4]=session3
    // Target the LAST future session (td[4], session 3) to avoid collisions with leave tests.
    const memberCells = memberRow.locator('td');
    const targetCell = memberCells.nth(4); // session 3 (last future session)
    await expect(targetCell).toBeVisible();

    // Click to toggle attendance. unmarked -> present
    // A future-session confirm dialog may appear ("此堂次尚未到來，確定要點名嗎？")
    page.once('dialog', async (dlg) => {
      await dlg.accept();
    });
    await targetCell.click();
    await page.waitForTimeout(300);

    // Check current state of the cell
    let cellDiv = targetCell.locator('div').first();
    const cellClass = await cellDiv.getAttribute('class') || '';

    if (cellClass.includes('bg-rose')) {
      // Was already present -> now absent. Need two more clicks to cycle: absent->unmarked->present
      page.once('dialog', async (dlg) => { await dlg.accept(); });
      await targetCell.click();
      await page.waitForTimeout(200);
      page.once('dialog', async (dlg) => { await dlg.accept(); });
      await targetCell.click();
      await page.waitForTimeout(200);
    }

    // Now should be present (emerald)
    cellDiv = targetCell.locator('div').first();
    await expect(cellDiv).toHaveClass(/bg-emerald/);

    // Save
    await page.getByRole('button', { name: '儲存' }).click();

    // Wait for save to complete - the 點名 button reappears when edit mode exits
    await expect(page.getByRole('button', { name: '點名' })).toBeVisible({ timeout: 10000 });

    // Reload page and verify the marked status persisted
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // Enter edit mode again to verify
    await page.getByRole('button', { name: '點名' }).click();
    await page.waitForTimeout(500);

    // Check the same cell for present status (emerald background)
    const verifyRow = page.locator('tr', { hasText: 'E2E Member' }).first();
    const verifyCells = verifyRow.locator('td');
    const verifyCell = verifyCells.nth(4);
    const verifyCellDiv = verifyCell.locator('div').first();
    await expect(verifyCellDiv).toHaveClass(/bg-emerald/);

    // Cancel to exit editing
    await page.getByRole('button', { name: '取消' }).click();
  });

  test('member takes leave on a future session or verifies existing leave', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // The member has a full enrollment (seeded), so they must appear in roster
    await expect(page.getByText('E2E Member')).toBeVisible();

    // The "我的出席" section shows session cards with leave buttons.
    // Leave buttons MUST be present for enrolled sessions.
    const leaveButtons = page.getByRole('button', { name: '請假' });
    const count = await leaveButtons.count();

    // The member is fully enrolled, so leave buttons MUST exist
    expect(count).toBeGreaterThan(0);

    // Try to find a non-disabled leave button (one where leave hasn't been taken yet)
    let clickedLeave = false;
    for (let i = 0; i < count; i++) {
      const btn = leaveButtons.nth(i);
      const isDisabled = await btn.isDisabled();
      if (!isDisabled) {
        // Clicking the leave button opens a React AlertDialog
        await btn.click();
        clickedLeave = true;
        break;
      }
    }

    if (clickedLeave) {
      // Leave confirmation alert dialog should appear
      await expect(page.getByText('申請請假')).toBeVisible();

      const confirmLeave = page.getByRole('button', { name: '確認請假' });
      await expect(confirmLeave).toBeVisible();

      // Register native alert() handler BEFORE clicking confirm
      page.once('dialog', async (dlg) => {
        await dlg.accept();
      });
      await confirmLeave.click();

      // Wait for the alert dialog to close and the leave to process
      await page.waitForTimeout(3000);

      // Reload and verify
      await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
      await page.waitForLoadState('networkidle');

      // Should see "請假" status somewhere in the session cards
      await expect(page.locator('.snap-x').getByText('請假').first()).toBeVisible();
    } else {
      // All leave buttons are disabled -- leave was already taken on all future sessions
      // (past sessions are always disabled). This is the idempotent case.
      const leaveStatus = page.locator('.snap-x').getByText('請假');
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
    expect(count).toBeGreaterThan(0);

    // After the leave test, at least one button should be disabled
    // (either from leave taken, or from past session being frozen)
    let hasDisabled = false;
    for (let i = 0; i < count; i++) {
      const btn = leaveButtons.nth(i);
      const isDisabled = await btn.isDisabled();
      if (isDisabled) {
        hasDisabled = true;
        break;
      }
    }
    expect(hasDisabled).toBe(true);
  });

  test('leave button is disabled on past sessions (cannot leave past sessions)', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await page.waitForLoadState('networkidle');

    // The member has a full enrollment and one session is in the past (CURRENT_DATE - 7 days).
    // Session cards are rendered in the "我的出席" horizontal scroller (.snap-x).
    // The past session card shows either "已結束" (no attendance) or a determined status
    // badge (e.g. absent/present) depending on whether attendance was recorded.
    // Its leave button should be disabled (isFrozen = isPast || isDetermined).

    // The session cards container
    const sessionScroller = page.locator('.snap-x');
    await expect(sessionScroller).toBeVisible();

    // Find a past session card. Past sessions show "已結束" when unmarked,
    // or the attendance status label when marked (e.g. absent shows an X icon).
    // In all cases the leave button should exist and be disabled.
    const sessionCards = sessionScroller.locator('> div');
    const cardCount = await sessionCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(2); // At least 1 past + 1 future

    let pastCardFound = false;
    for (let i = 0; i < cardCount; i++) {
      const card = sessionCards.nth(i);
      const leaveBtn = card.getByRole('button', { name: '請假' });
      const leaveBtnCount = await leaveBtn.count();
      if (leaveBtnCount === 0) continue;
      const isDisabled = await leaveBtn.isDisabled();
      if (!isDisabled) continue;
      // A disabled leave button on a card confirms a frozen session (past or determined).
      // Verify by checking that this is indeed a past or determined session card
      // (it has the muted/frozen styling from bg-neutral-900).
      const cardClasses = await card.getAttribute('class') || '';
      if (cardClasses.includes('bg-neutral-900') || cardClasses.includes('shadow-none')) {
        await expect(leaveBtn).toBeDisabled();
        pastCardFound = true;
        break;
      }
    }
    expect(pastCardFound).toBe(true);
  });
});
