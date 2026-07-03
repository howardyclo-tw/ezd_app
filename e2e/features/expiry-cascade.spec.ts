import { test, expect } from '@playwright/test';
import { getAdminClient, getUserIdByEmail } from '../fixtures/db';
import { loginAs } from '../fixtures/auth';

/**
 * Expiry cascade: when an admin extends a member group's valid_until,
 * confirmed card_purchase orders whose expires_at equalled the old date
 * are updated to the new date, and the user's balance stays intact.
 *
 * This test drives the REAL updateMemberGroup server action via the
 * e2e-test-actions API route (with admin auth), NOT a replicated cascade.
 *
 * Negative case: a confirmed order with a CUSTOM expires_at (different
 * from the group valid_until) must remain unchanged after the cascade,
 * proving the cascade does not over-reach.
 */

// Deterministic IDs matching global-setup.ts
const MEMBER_GROUP_ID       = 'e2e00000-0000-0000-0000-000000000001';
const CARD_ORDER_ID         = 'e2e00000-0000-0000-0000-000000000040'; // card10 order
const CUSTOM_EXPIRY_ORDER_ID = 'e2e00000-0000-0000-0000-000000000043'; // custom-expiry order

const ORIGINAL_VALID_UNTIL = '2026-12-31';
const EXTENDED_VALID_UNTIL = '2027-06-30';
const CUSTOM_EXPIRY_DATE   = '2027-12-31'; // intentionally different from group valid_until

test.describe('Expiry Cascade on Group Extension', () => {
  let memberId: string;

  test.beforeAll(async () => {
    memberId = await getUserIdByEmail('e2e-member@mediatek.com');
  });

  test.afterAll(async () => {
    // Restore original valid_until so other tests are not affected
    const db = getAdminClient();
    await db.from('member_groups').update({ valid_until: ORIGINAL_VALID_UNTIL }).eq('id', MEMBER_GROUP_ID);
    // Restore the seed order's expires_at
    await db.from('orders').update({ expires_at: ORIGINAL_VALID_UNTIL }).eq('id', CARD_ORDER_ID);
    // Restore custom-expiry order (should not have changed, but restore for safety)
    await db.from('orders').update({ expires_at: CUSTOM_EXPIRY_DATE }).eq('id', CUSTOM_EXPIRY_ORDER_ID);
    // Re-sync balance: card10(10 unused) + card2(0 unused) + customExpiry(5 unused) = 15
    const { data: orders } = await db
      .from('orders')
      .select('quantity, used, expires_at')
      .eq('user_id', memberId)
      .eq('status', 'confirmed')
      .eq('order_type', 'card_purchase');
    const balance = (orders ?? []).reduce((sum, o) => {
      const rem = o.quantity - o.used;
      if (rem <= 0) return sum;
      return sum + rem;
    }, 0);
    await db.from('profiles').update({ card_balance: balance }).eq('id', memberId);
  });

  test('confirmed card order expires_at matches group valid_until initially', async () => {
    const db = getAdminClient();

    // Verify the seed order expires_at = group valid_until
    const { data: order } = await db
      .from('orders')
      .select('expires_at, status')
      .eq('id', CARD_ORDER_ID)
      .single();

    expect(order).not.toBeNull();
    expect(order!.status).toBe('confirmed');
    expect(order!.expires_at).toBe(ORIGINAL_VALID_UNTIL);

    // Verify group valid_until matches
    const { data: group } = await db
      .from('member_groups')
      .select('valid_until')
      .eq('id', MEMBER_GROUP_ID)
      .single();

    expect(group).not.toBeNull();
    expect(group!.valid_until).toBe(ORIGINAL_VALID_UNTIL);

    // Verify custom-expiry order has a DIFFERENT expires_at
    const { data: customOrder } = await db
      .from('orders')
      .select('expires_at, status')
      .eq('id', CUSTOM_EXPIRY_ORDER_ID)
      .single();

    expect(customOrder).not.toBeNull();
    expect(customOrder!.status).toBe('confirmed');
    expect(customOrder!.expires_at).toBe(CUSTOM_EXPIRY_DATE);
    expect(customOrder!.expires_at).not.toBe(ORIGINAL_VALID_UNTIL);
  });

  test('extending group valid_until cascades to matching order, leaves custom-expiry order untouched', async ({ page }) => {
    const db = getAdminClient();

    // Record balance before cascade
    const { data: profileBefore } = await db
      .from('profiles')
      .select('card_balance')
      .eq('id', memberId)
      .single();
    const balanceBefore = profileBefore!.card_balance;

    // Login as admin and call updateMemberGroup via the real server action
    await loginAs(page, 'admin');

    const response = await page.request.post('http://[::1]:3000/api/e2e-test-actions', {
      data: {
        action: 'updateMemberGroup',
        groupId: MEMBER_GROUP_ID,
        groupName: 'E2E Test Group 2026',
        groupValidUntil: EXTENDED_VALID_UNTIL,
      },
    });

    const result = await response.json();
    expect(result.success).toBe(true);

    // POSITIVE: Verify the matching card order's expires_at was cascaded
    const { data: orderAfter } = await db
      .from('orders')
      .select('expires_at')
      .eq('id', CARD_ORDER_ID)
      .single();
    expect(orderAfter!.expires_at).toBe(EXTENDED_VALID_UNTIL);

    // NEGATIVE: Verify the custom-expiry order was NOT touched by the cascade
    const { data: customOrderAfter } = await db
      .from('orders')
      .select('expires_at')
      .eq('id', CUSTOM_EXPIRY_ORDER_ID)
      .single();
    expect(customOrderAfter!.expires_at).toBe(CUSTOM_EXPIRY_DATE);

    // Verify balance is intact (same as before since expiry was extended, not shortened)
    const { data: profileAfter } = await db
      .from('profiles')
      .select('card_balance')
      .eq('id', memberId)
      .single();
    expect(profileAfter!.card_balance).toBe(balanceBefore);
  });
});
