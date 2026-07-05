import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Feature test: Registration entry point + window-driven states (5R.2)
 *
 * Tests the group page enrollment button lifecycle:
 *   H1: Open window → CTA visible, navigates to /register
 *   H2: Closed window → disabled "整期報名已截止"
 *   H3: Future window → disabled with opening date
 *   H4: No window → student sees no button
 *   A1: /register with closed window → friendly message, not wizard
 *   A2: /register with no window → friendly message
 *
 * Seed fixtures (e2e/global-setup.ts):
 *   - IDS.courseGroup:        open phase1 window (now-1d to now+7d)
 *   - IDS.closedPhase1Group:  closed phase1 window (now-7d to now-1d)
 *   - IDS.futureWindowGroup:  future window (now+1d to now+14d), slug 'e2e-futwin'
 *   - IDS.noWindowGroup:      no registration window, slug 'e2e-nowin'
 */

const MAIN_GROUP_ID   = 'e2e00000-0000-0000-0000-000000000010';
const CLOSED_GROUP_ID = 'e2e00000-0000-0000-0000-000000000011';

test.describe('Register entry point + window states', () => {
  test('H1: open window — CTA navigates to /register', async ({ page }) => {
    // Use guest on main courseGroup (open window, no enrollments for guest)
    await loginAs(page, 'guest');
    await page.goto(`/courses/groups/${MAIN_GROUP_ID}`);
    await expect(page.getByRole('heading', { name: 'E2E H2 2026 Course Group' })).toBeVisible({ timeout: 15000 });

    const cta = page.getByRole('link', { name: /整期報名/ });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/register/, { timeout: 10000 });
  });

  test('H2: closed window — disabled button + 已截止', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto(`/courses/groups/${CLOSED_GROUP_ID}`);
    await expect(page.getByRole('heading', { name: 'E2E Closed Phase1 Group' })).toBeVisible({ timeout: 15000 });

    const btn = page.getByRole('button', { name: /整期報名已截止/ });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('H3: future window — disabled button with opening date', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto('/courses/groups/e2e-futwin');
    await expect(page.getByRole('heading', { name: 'E2E Future Window Group' })).toBeVisible({ timeout: 15000 });

    const btn = page.getByRole('button', { name: /整期報名.*開放/ });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('H4: no window — student sees no enrollment button', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto('/courses/groups/e2e-nowin');
    await expect(page.getByRole('heading', { name: 'E2E No Window Group' })).toBeVisible({ timeout: 15000 });

    await expect(page.getByRole('button', { name: /整期報名/ })).not.toBeVisible();
    await expect(page.getByRole('link', { name: /整期報名/ })).not.toBeVisible();
  });

  test('A1: /register with closed window — friendly closed message', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto(`/courses/groups/${CLOSED_GROUP_ID}/register`);

    await expect(page.getByText('整期報名已截止')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /返回檔期頁面/ })).toBeVisible();
  });

  test('A2: /register with no window — friendly not-configured message', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto('/courses/groups/e2e-nowin/register');

    await expect(page.getByText('報名時段尚未設定')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /返回檔期頁面/ })).toBeVisible();
  });
});
