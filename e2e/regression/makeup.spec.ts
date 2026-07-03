import { test, expect } from '@playwright/test';
import { loginAs, ACCOUNTS } from '../fixtures/auth';
import { getUserIdByEmail, getAttendanceRecord } from '../fixtures/db';

/**
 * Regression baseline: Makeup (supplementary class enrollment)
 *
 * Pre-conditions (from e2e/global-setup.ts):
 *   - E2E Member is full-enrolled in E2E Basic Groove (normal, 5 sessions)
 *   - Member has an absence (status=absent) on session 0 (past, -7 days)
 *   - E2E Single Course is in the same group, member is NOT enrolled there
 *   - Makeup quota for 5-session course = ceil(5/4) = 2, but only 1 absence => remaining = 1
 *   - Member's profiles.makeup_quota = 0 (no manual bonus)
 *
 * Happy path:
 *   Member navigates to E2E Single Course, opens the enrollment dialog,
 *   selects "補課申請" mode, picks a future session, and submits.
 *   Asserts success message, and the member appears in the roster with makeup status.
 *
 * Adversarial:
 *   Admin (who has no full-enrollment in any course) navigates to E2E Single Course,
 *   opens the enrollment dialog. The makeup option should be disabled (greyed out)
 *   because admin has no enrollment and thus 0 remaining makeup quota.
 *
 * Idempotency: globalSetup re-seeds the DB before every suite run.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const SINGLE_COURSE_ID = 'e2e00000-0000-0000-0000-000000000021'; // E2E Single Course

test.describe('Makeup', () => {
  test('member performs makeup from absence into another course', async ({ page }) => {
    await loginAs(page, 'member');

    // Navigate to E2E Single Course (member is NOT enrolled here)
    await page.goto(`/courses/groups/${GROUP_ID}/${SINGLE_COURSE_ID}`);

    // Wait for SSR streaming to deliver the course heading
    await expect(page.getByRole('heading', { name: 'E2E Single Course' })).toBeVisible();

    // The SessionEnrollmentDialog trigger button MUST be visible since
    // member is not enrolled in this course (seed deletes all enrollments).
    const enrollButton = page.getByRole('button', { name: /單堂報名/ });
    await expect(enrollButton).toBeVisible();

    // Open the enrollment dialog
    await enrollButton.click();

    // The dialog should show "選擇加入方式" with both "單堂報名" and "補課申請" options
    await expect(page.getByText('選擇加入方式')).toBeVisible();

    // The makeup option should be available (member has 1 remaining quota from absence)
    const makeupText = page.locator('p', { hasText: '補課申請' }).first();
    await expect(makeupText).toBeVisible();

    // Check if the parent div has opacity-40 (disabled state) or not
    const makeupContainer = makeupText.locator('..');
    const parentDiv = makeupContainer.locator('..');

    // Click the makeup option
    await parentDiv.click();

    // Dialog title should change to "補課申請"
    await expect(page.getByText('補課申請').first()).toBeVisible();

    // Select the first available future session
    const sessionItems = page.locator('[class*="rounded-2xl"][class*="border-2"]');
    await expect(sessionItems.first()).toBeVisible();
    const sessionCount = await sessionItems.count();
    expect(sessionCount).toBeGreaterThan(0);

    // Click the first non-disabled session
    let selectedSession = false;
    for (let i = 0; i < sessionCount; i++) {
      const item = sessionItems.nth(i);
      const classes = await item.getAttribute('class') || '';
      // Skip disabled items (they have opacity-50 and cursor-not-allowed)
      if (classes.includes('cursor-not-allowed') || classes.includes('opacity-50')) {
        continue;
      }
      await item.click();
      selectedSession = true;
      break;
    }

    expect(selectedSession).toBe(true);

    // Click the submit button "確認報名 (1)"
    const submitBtn = page.getByRole('button', { name: /確認報名/ });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // The makeup flow uses toast notifications (sonner), not browser alerts.
    // Wait for the success toast to appear.
    const successToast = page.locator('[data-sonner-toast]', { hasText: /補課成功|成功完成/ });
    await expect(successToast.first()).toBeVisible({ timeout: 15000 });

    // Wait for page to settle
    await page.waitForTimeout(1000);

    // Reload the course page to verify the makeup record
    await page.goto(`/courses/groups/${GROUP_ID}/${SINGLE_COURSE_ID}`);

    // Verify: E2E Member should now appear in the roster of the target course
    // Scope to the table to avoid strict-mode violations (name may appear elsewhere)
    await expect(page.getByRole('table').getByText('E2E Member')).toBeVisible();

    // DB-state assertion: verify an attendance_records row with status='makeup' exists
    const memberId = await getUserIdByEmail(ACCOUNTS.member.email);
    const SINGLE_SESSION_IDS = [
      'e2e00000-0000-0000-0000-000000000034',
      'e2e00000-0000-0000-0000-000000000035',
      'e2e00000-0000-0000-0000-000000000036',
    ];
    let foundMakeupRecord = false;
    for (const sid of SINGLE_SESSION_IDS) {
      const record = await getAttendanceRecord(memberId, sid);
      if (record?.status === 'makeup') {
        foundMakeupRecord = true;
        break;
      }
    }
    expect(foundMakeupRecord).toBe(true);
  });

  test('admin without enrollment sees makeup option disabled', async ({ page }) => {
    await loginAs(page, 'admin');

    // Navigate to E2E Single Course
    await page.goto(`/courses/groups/${GROUP_ID}/${SINGLE_COURSE_ID}`);

    // Wait for the heading to confirm SSR content is ready
    await expect(page.getByRole('heading', { name: 'E2E Single Course' })).toBeVisible();

    // Admin is not enrolled, so the enrollment dialog trigger MUST be visible
    const enrollButton = page.getByRole('button', { name: /單堂報名/ });
    await expect(enrollButton).toBeVisible();

    // Open the enrollment dialog
    await enrollButton.click();
    await expect(page.getByText('選擇加入方式')).toBeVisible();

    // The makeup option should be DISABLED because admin has no enrollment
    const disabledIndicator = page.getByText('目前無可用補課額度');
    await expect(disabledIndicator).toBeVisible();

    // Verify the makeup option container has the disabled styling
    const makeupDiv = disabledIndicator.locator('..').locator('..');
    const classes = await makeupDiv.getAttribute('class') || '';
    expect(classes).toContain('cursor-not-allowed');

    // Try clicking it - should NOT change mode to "補課申請"
    await makeupDiv.click();
    // The title should still be "選擇加入方式", NOT "補課申請"
    await expect(page.getByText('選擇加入方式')).toBeVisible();

    // Close the dialog
    const closeBtn = page.getByRole('button', { name: '關閉' });
    await closeBtn.click();
  });
});
