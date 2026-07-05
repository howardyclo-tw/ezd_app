import { test, expect } from '@playwright/test';
import { loginAs } from '../fixtures/auth';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';

const MULTI_CARD_ENROLLMENT_ID = 'e2e00000-0000-0000-0000-000000000061';
const CARD10 = 'e2e00000-0000-0000-0000-000000000040';
const CARD2  = 'e2e00000-0000-0000-0000-000000000041';
const CARD_CUSTOM = 'e2e00000-0000-0000-0000-000000000043';

async function resetCardSeedState() {
    const sb = getAdminClient();
    const memberId = await getUserIdByEmail('e2e-member@mediatek.com');
    await sb.from('orders').update({ used: 0 }).eq('id', CARD10);
    await sb.from('orders').update({ used: 2 }).eq('id', CARD2);
    await sb.from('orders').update({ used: 0 }).eq('id', CARD_CUSTOM);
    await sb.from('enrollments').update({ status: 'enrolled' }).eq('id', MULTI_CARD_ENROLLMENT_ID);
    await sb.from('profiles').update({ card_balance: 15 }).eq('id', memberId);
}

test.describe('Refund Count: cards_per_session', () => {
  test('rejecting a single enrollment on a cards_per_session=2 course refunds 2 cards', async ({ page }) => {
    test.setTimeout(90_000);

    await resetCardSeedState();

    // ── Step 1: Login as member, record initial card balance ──
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();

    const balanceEl = page.locator('[data-testid="card-balance"]');
    await expect(balanceEl).toBeVisible();
    const balText = await balanceEl.textContent();
    const initialBalance = parseInt(balText?.trim() || '0', 10);

    // ── Step 2: Login as admin, navigate to review center ──
    await page.context().clearCookies();
    await loginAs(page, 'admin');
    await page.goto('/leader/approvals');

    // Click the single enrollment tab
    await page.getByRole('tab', { name: '單堂報名' }).click();

    // ── Step 3: Reject the multi-card enrollment ──
    page.on('dialog', dialog => dialog.accept());

    const card = page.locator('[data-slot="card"]')
      .filter({ hasText: 'E2E Multi-Card Course' });

    const rejectButton = card.getByRole('button', { name: '駁回' });
    await expect(rejectButton).toBeVisible({ timeout: 10000 });
    await rejectButton.click();

    await expect(rejectButton).not.toBeVisible({ timeout: 15000 });

    // ── Step 4: Login as member, verify balance increased by 2 ──
    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/dashboard/my_cards');

    await page.getByRole('tab', { name: '使用中' }).click();

    const newBalanceEl = page.locator('[data-testid="card-balance"]');
    await expect(newBalanceEl).toBeVisible();
    const newText = await newBalanceEl.textContent();
    const newBalance = parseInt(newText?.trim() || '0', 10);

    // Card balance should have increased by exactly 2 (cards_per_session for this course)
    expect(newBalance).toBe(initialBalance + 2);
  });
});
