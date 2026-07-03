import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

/**
 * Regression baseline: Admin Members management
 * 1. Admin views member list, sees E2E Member
 * 2. Admin opens member detail dialog
 * 3. Admin edits role (e.g., member -> admin -> member restore)
 * 4. Admin edits member group assignment
 * 5. Admin adjusts makeup quota
 * 6. Admin views card pool
 */

test.describe('Admin Members Management', () => {
  test('admin can view and edit member profile (role, group, makeup quota, card pool)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/members');

    // ── Step 1: Verify the page loaded with title "成員管理" ──
    await expect(page.getByText('成員管理')).toBeVisible();

    // ── Step 2: Find and click on E2E Member ──
    const memberCard = page.locator('text=E2E Member').first();
    await expect(memberCard).toBeVisible();
    await memberCard.click();

    // ── Step 3: Verify the edit dialog opens ──
    await expect(page.getByText('成員帳號管理')).toBeVisible();
    // Dialog header shows member name -- use the dialog scope to avoid ambiguity
    const dialog = page.getByLabel('成員帳號管理');
    await expect(dialog.getByText('E2E Member')).toBeVisible();

    // ── Step 4: Verify role selector shows current role (社員) ──
    // The role selector is a Select component with label "身份等級"
    await expect(dialog.getByText('身份等級')).toBeVisible();

    // The SelectTrigger should show "社員" for member role
    const roleSelect = dialog.locator('button[role="combobox"]').first();
    await expect(roleSelect).toBeVisible();
    const currentRole = await roleSelect.textContent();
    expect(currentRole).toContain('社員');

    // ── Step 5: Change role to 幹部 then back to 社員 ──
    await roleSelect.click();

    // Select "幹部" (admin) -- wait for dropdown to open before clicking option
    const adminOption = page.getByRole('option', { name: '幹部' });
    await expect(adminOption).toBeVisible();
    await adminOption.click();

    // Verify it changed (poll until select reflects new value)
    await expect.poll(async () => roleSelect.textContent(), { timeout: 5000 }).toContain('幹部');

    // Change back to 社員 (use exact match to avoid matching 非社員)
    await roleSelect.click();
    const memberOption = page.getByRole('option', { name: '社員', exact: true });
    await expect(memberOption).toBeVisible();
    await memberOption.click();

    // ── Step 6: Verify member group selector ──
    await expect(dialog.getByText('所屬年度群組')).toBeVisible();

    // The group selector is the second combobox in the dialog
    const groupSelect = dialog.locator('button[role="combobox"]').nth(1);
    await expect(groupSelect).toBeVisible();

    // Should show the E2E Test Group
    const groupText = await groupSelect.textContent();
    expect(groupText).toContain('E2E Test Group 2026');

    // ── Step 7: Verify and adjust makeup quota ──
    await expect(dialog.getByText('總補課額度')).toBeVisible();

    // The makeup quota input is inside the orange-themed section (unconditional).
    const makeupInput = dialog.locator('[class*="bg-orange"] input[type="number"]');
    await expect(makeupInput.first()).toBeVisible();
    // Set makeup quota to 2
    await makeupInput.first().fill('2');
    await page.waitForTimeout(300);

    // ── Step 8: Verify card pool section (unconditional) ──
    await expect(dialog.getByText('堂卡餘額')).toBeVisible();

    // The card balance number MUST be visible (from seed: 10 cards, possibly modified by other tests)
    const cardSection = dialog.locator('[class*="bg-primary"]').first();
    const balanceDisplay = cardSection.locator('.text-xl').first();
    await expect(balanceDisplay).toBeVisible();
    const balanceText = await balanceDisplay.textContent();
    const balance = parseInt(balanceText?.trim() || '0', 10);
    expect(balance).toBeGreaterThanOrEqual(0);

    // ── Step 9: Save changes ──
    await dialog.getByRole('button', { name: '確認變更' }).click();

    // Wait for the dialog to close after save completes (replaces waitForTimeout)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // ── Step 10: Re-open and verify changes persisted ──
    // Click on E2E Member again
    await page.locator('text=E2E Member').first().click();

    // Wait for the edit dialog to reopen (replaces waitForTimeout)
    const dialog2 = page.getByLabel('成員帳號管理');
    await expect(dialog2).toBeVisible({ timeout: 10000 });
    const verifyRole = dialog2.locator('button[role="combobox"]').first();
    const verifyRoleText = await verifyRole.textContent();
    expect(verifyRoleText).toContain('社員');

    // Close dialog
    await dialog2.getByRole('button', { name: '關閉' }).click();
  });

  test('admin can view member card pool details', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/members');

    // Open E2E Member detail
    await page.locator('text=E2E Member').first().click();

    // Wait for the dialog content to load (replaces waitForTimeout)
    await expect(page.getByText('堂卡餘額')).toBeVisible({ timeout: 10000 });

    // Check if there are card pool entries showing "張" (cards) count
    const poolEntries = page.locator('text=/\\d+ 張/');
    const poolCount = await poolEntries.count();

    // Should have at least one card pool entry (from seed: 10 cards confirmed)
    expect(poolCount).toBeGreaterThanOrEqual(1);

    // Card pool entries should show expiry dates (unconditional)
    // The seed has expires_at = 2026-12-31
    const expiryText = page.locator('text=/到期 2026/');
    await expect(expiryText.first()).toBeVisible();

    // Close
    await page.getByRole('button', { name: '關閉' }).click();
  });
});
