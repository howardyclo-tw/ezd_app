import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient } from '../fixtures/db';

/**
 * Feature test: Course form pricing_mode, NTD prices, and enroll switches
 *
 * Uses the E2E course_group fixture from global-setup.ts.
 *
 * Tests:
 *   1. Admin creates an NTD workshop with all 4 prices + both enroll switches on
 *      -> assert the persisted DB row has correct pricing_mode, prices, enroll flags.
 *   2. Admin sets pricing_mode=ntd but leaves a required price blank
 *      -> submit is blocked; no course row created.
 *   3. Selecting type=style prefills pricing_mode=ntd, enroll_single=true,
 *      enroll_full=false, price_member_single=0
 *      -> assert form values; create it and assert persisted row.
 *
 * Cleanup: afterAll deletes courses + sessions created by this spec.
 */

const NAME_PREFIX = 'E2E-PricingSpec';

/** Collect course ids created during the run for cleanup. */
const createdCourseIds: string[] = [];

test.afterAll(async () => {
  const sb = getAdminClient();
  if (createdCourseIds.length === 0) return;

  // Delete sessions first (FK), then courses
  for (const courseId of createdCourseIds) {
    await sb.from('course_sessions').delete().eq('course_id', courseId);
    await sb.from('courses').delete().eq('id', courseId);
  }
});

/**
 * Helper: query the created course by exact name from DB.
 */
async function findCourseByName(name: string) {
  const sb = getAdminClient();
  const { data, error } = await sb
    .from('courses')
    .select('id, name, pricing_mode, price_member_single, price_guest_single, price_member_full, price_guest_full, enroll_full, enroll_single, type')
    .eq('name', name)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`findCourseByName failed: ${error.message}`);
  return data;
}

/**
 * Helper: fill the minimum required base course fields (group, name, teacher, room, date).
 * Caller is responsible for type, pricing, and enroll fields.
 */
async function fillBaseFields(page: import('@playwright/test').Page, courseName: string) {
  // Select course group
  const groupTrigger = page.locator('[data-slot="form-item"]').filter({ hasText: '所屬課程檔期' }).locator('button[role="combobox"]');
  await groupTrigger.click();
  await page.getByRole('option', { name: /E2E H2 2026/ }).click();

  // Fill name
  await page.getByLabel('課程名稱').fill(courseName);

  // Fill teacher
  const teacherInput = page.locator('[data-slot="form-item"]').filter({ hasText: '老師' }).locator('input');
  await teacherInput.fill('E2E Teacher');

  // Fill room
  const roomInput = page.locator('[data-slot="form-item"]').filter({ hasText: '教室' }).locator('input');
  await roomInput.fill('E2E Room');

  // Set sessions count to 1
  const sessionsInput = page.locator('[data-slot="form-item"]').filter({ hasText: '總堂數' }).locator('input');
  await sessionsInput.fill('1');

  // Pick first session date — click the button that says "選擇日期" in the first_session_at field
  const firstDateItem = page.locator('[data-slot="form-item"]').filter({ hasText: '第一堂日期' });
  const dateBtn = firstDateItem.locator('button');
  await dateBtn.click();
  // Click a future date in the calendar
  const calendarDay = page.locator('[role="gridcell"] button:not([disabled])').last();
  await calendarDay.click();
}

test.describe('Course form pricing', () => {
  test('admin creates NTD workshop with all prices and both enroll modes', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/courses/new');
    await page.waitForLoadState('networkidle');

    const courseName = `${NAME_PREFIX}-NTD-Workshop-${Date.now()}`;

    // Select type = workshop (triggers pricing defaults to ntd)
    const typeItem = page.locator('[data-slot="form-item"]').filter({ hasText: '課程類型' }).first();
    await typeItem.locator('button[role="combobox"]').click();
    await page.getByRole('option', { name: '專攻班' }).click();

    // Wait for type-change effect
    await page.waitForTimeout(300);

    await fillBaseFields(page, courseName);

    // Verify pricing_mode was auto-set to ntd
    const pricingTrigger = page.locator('[data-testid="pricing-mode-select"]');
    await expect(pricingTrigger).toContainText('現金');

    // Verify both enroll switches are on (workshop default)
    const enrollFullSwitch = page.locator('[data-testid="enroll-full-switch"]');
    const enrollSingleSwitch = page.locator('[data-testid="enroll-single-switch"]');
    await expect(enrollFullSwitch).toHaveAttribute('data-state', 'checked');
    await expect(enrollSingleSwitch).toHaveAttribute('data-state', 'checked');

    // Fill all 4 NTD prices
    await page.getByLabel('社員單堂價格', { exact: true }).fill('100');
    await page.getByLabel('非社員單堂價格', { exact: true }).fill('200');
    await page.getByLabel('社員整期價格', { exact: true }).fill('700');
    await page.getByLabel('非社員整期價格', { exact: true }).fill('1400');

    // Submit
    await page.getByRole('button', { name: '完成' }).click();

    // Wait for success toast
    await expect(page.getByText('成功建立課程')).toBeVisible({ timeout: 15000 });

    // Assert DB row
    const course = await findCourseByName(courseName);
    expect(course).not.toBeNull();
    createdCourseIds.push(course!.id);

    expect(course!.pricing_mode).toBe('ntd');
    expect(course!.price_member_single).toBe(100);
    expect(course!.price_guest_single).toBe(200);
    expect(course!.price_member_full).toBe(700);
    expect(course!.price_guest_full).toBe(1400);
    expect(course!.enroll_full).toBe(true);
    expect(course!.enroll_single).toBe(true);
    expect(course!.type).toBe('workshop');
  });

  test('NTD mode with blank required price blocks submit', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/courses/new');
    await page.waitForLoadState('networkidle');

    const courseName = `${NAME_PREFIX}-NTD-MissingPrice-${Date.now()}`;

    // Select type = workshop (sets defaults to ntd)
    const typeItem = page.locator('[data-slot="form-item"]').filter({ hasText: '課程類型' }).first();
    await typeItem.locator('button[role="combobox"]').click();
    await page.getByRole('option', { name: '專攻班' }).click();

    await page.waitForTimeout(300);

    await fillBaseFields(page, courseName);

    // Fill only member single price, leave guest single blank
    await page.getByLabel('社員單堂價格', { exact: true }).fill('100');
    // Leave 非社員單堂價格 blank
    // Fill full prices
    await page.getByLabel('社員整期價格', { exact: true }).fill('700');
    await page.getByLabel('非社員整期價格', { exact: true }).fill('1400');

    // Attempt submit
    await page.getByRole('button', { name: '完成' }).click();

    // Should see validation error — form should NOT navigate away from /courses/new
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/courses\/new/);

    // Verify the validation error is visible on the guest single price field
    const errorMsg = page.getByText('請輸入非社員單堂價格');
    await expect(errorMsg).toBeVisible();

    // Verify NO course was created in the DB
    const course = await findCourseByName(courseName);
    expect(course).toBeNull();
  });

  test('selecting type=style prefills pricing defaults and creates correctly', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/courses/new');
    await page.waitForLoadState('networkidle');

    const courseName = `${NAME_PREFIX}-Style-Defaults-${Date.now()}`;

    // Select type = style
    const typeItem = page.locator('[data-slot="form-item"]').filter({ hasText: '課程類型' }).first();
    await typeItem.locator('button[role="combobox"]').click();
    await page.getByRole('option', { name: '風格體驗' }).click();

    // Wait for defaults to apply
    await page.waitForTimeout(500);

    // Assert form values: pricing_mode=ntd
    const pricingTrigger = page.locator('[data-testid="pricing-mode-select"]');
    await expect(pricingTrigger).toContainText('現金');

    // enroll_full should be OFF, enroll_single should be ON
    const enrollFullSwitch = page.locator('[data-testid="enroll-full-switch"]');
    const enrollSingleSwitch = page.locator('[data-testid="enroll-single-switch"]');
    await expect(enrollFullSwitch).toHaveAttribute('data-state', 'unchecked');
    await expect(enrollSingleSwitch).toHaveAttribute('data-state', 'checked');

    // price_member_single should be prefilled with 0
    const memberSingleInput = page.getByLabel('社員單堂價格', { exact: true });
    await expect(memberSingleInput).toHaveValue('0');

    // Fill required fields and the guest single price
    await fillBaseFields(page, courseName);
    await page.getByLabel('非社員單堂價格', { exact: true }).fill('350');

    // Submit
    await page.getByRole('button', { name: '完成' }).click();

    // Wait for success toast
    await expect(page.getByText('成功建立課程')).toBeVisible({ timeout: 15000 });

    // Assert DB row
    const course = await findCourseByName(courseName);
    expect(course).not.toBeNull();
    createdCourseIds.push(course!.id);

    expect(course!.pricing_mode).toBe('ntd');
    expect(course!.enroll_single).toBe(true);
    expect(course!.enroll_full).toBe(false);
    expect(course!.price_member_single).toBe(0);
    expect(course!.price_guest_single).toBe(350);
    // Full prices should be null since enroll_full is false
    expect(course!.price_member_full).toBeNull();
    expect(course!.price_guest_full).toBeNull();
    expect(course!.type).toBe('style');
  });
});
