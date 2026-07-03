import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

/**
 * Regression: Waitlist cancel button (取消候補)
 *
 * E2E Member2 is seeded with a waitlist enrollment (status='waitlist')
 * on "E2E Single Course". This test verifies:
 *   1. The 候補中 badge is visible
 *   2. The 取消候補 button is visible and clickable
 *   3. After clicking, the enrollment is cancelled in the DB
 *
 * globalSetup re-seeds the waitlist enrollment each run, so this test
 * is fully re-runnable.
 */

const GROUP_ID = 'e2e00000-0000-0000-0000-000000000010';
const COURSE_ID = 'e2e00000-0000-0000-0000-000000000021';
const WAITLIST_ENROLLMENT_ID = 'e2e00000-0000-0000-0000-000000000064';

test.describe('Waitlist Cancel', () => {
  test('member cancels waitlist enrollment via 取消候補 button', async ({ page }) => {
    await loginAs(page, 'member2');

    // Navigate to the waitlisted course
    await page.goto(`/courses/groups/${GROUP_ID}/${COURSE_ID}`);
    await expect(page.getByText('E2E Single Course')).toBeVisible();

    // Assert the 候補中 badge is visible
    await expect(page.getByText('候補中')).toBeVisible();

    // Assert the 取消候補 button is visible
    const cancelBtn = page.getByRole('button', { name: '取消候補' });
    await expect(cancelBtn).toBeVisible();

    // Set up alert handler before clicking
    const alertPromise = page.waitForEvent('dialog');

    // Click 取消候補
    await cancelBtn.click();

    // Handle the alert dialog
    const dialog = await alertPromise;
    expect(dialog.message()).toContain('已取消');
    await dialog.accept();

    // Wait for page to refresh after router.refresh()
    await page.waitForTimeout(1000);

    // UI: 候補中 badge should be gone
    await expect(page.getByText('候補中')).not.toBeVisible();

    // DB: verify enrollment is actually cancelled
    const memberId = await getUserIdByEmail('e2e-member2@mediatek.com');
    const sb = getAdminClient();
    const { data: enrollment } = await sb
      .from('enrollments')
      .select('status')
      .eq('id', WAITLIST_ENROLLMENT_ID)
      .single();

    expect(enrollment).not.toBeNull();
    expect(enrollment!.status).toBe('cancelled');
  });
});
