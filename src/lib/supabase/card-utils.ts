'use server';

import { createAdminClient } from './admin';
import { createClient } from './server';

interface CardPool {
    id: string;
    quantity: number;
    used: number;
    remaining: number;
    expires_at: string | null;
    created_at: string;
}

/**
 * Get available (unexpired) card balance for a user as of a specific date.
 * If no date specified, uses today.
 */
export async function getAvailableCardBalance(userId: string, asOfDate?: string): Promise<{
    total: number;
    available: number;
    expired: number;
    pools: CardPool[];
}> {
    const supabase = await createClient();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const checkDate = asOfDate || today;

    const { data: orders } = await supabase
        .from('card_orders')
        .select('id, quantity, used, expires_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .order('expires_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

    const pools: CardPool[] = (orders ?? []).map(o => ({
        id: o.id,
        quantity: o.quantity,
        used: o.used,
        remaining: o.quantity - o.used,
        expires_at: o.expires_at,
        created_at: o.created_at,
    }));

    let total = 0;
    let available = 0;
    let expired = 0;

    for (const pool of pools) {
        if (pool.remaining <= 0) continue;
        total += pool.remaining;
        if (pool.expires_at && pool.expires_at < checkDate) {
            expired += pool.remaining;
        } else {
            available += pool.remaining;
        }
    }

    return { total, available, expired, pools };
}

/**
 * Deduct cards using FIFO (earliest expiring first).
 * Only deducts from pools that haven't expired as of courseEndDate.
 * Returns true if successful, throws if insufficient balance.
 */
export async function deductCardsFIFO(
    userId: string,
    amount: number,
    courseEndDate: string,
    note: string,
    enrollmentId?: string,
    actorId?: string
): Promise<{ success: boolean; newBalance: number }> {
    if (amount <= 0) return { success: true, newBalance: 0 };

    const adminClient = createAdminClient();

    // Get available pools (not expired as of courseEndDate, ordered FIFO)
    const { data: orders } = await adminClient
        .from('card_orders')
        .select('id, quantity, used, expires_at')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .order('expires_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

    const availablePools = (orders ?? []).filter(o => {
        const remaining = o.quantity - o.used;
        if (remaining <= 0) return false;
        // Pool must not expire before the course ends
        if (o.expires_at && o.expires_at < courseEndDate) return false;
        return true;
    });

    const totalAvailable = availablePools.reduce((sum, o) => sum + (o.quantity - o.used), 0);
    if (totalAvailable < amount) {
        throw new Error(`堂卡餘額不足（可用: ${totalAvailable}, 需扣除: ${amount}）`);
    }

    // FIFO deduction
    let remaining = amount;
    for (const pool of availablePools) {
        if (remaining <= 0) break;
        const poolRemaining = pool.quantity - pool.used;
        const toDeduct = Math.min(poolRemaining, remaining);

        await adminClient
            .from('card_orders')
            .update({ used: pool.used + toDeduct })
            .eq('id', pool.id);

        remaining -= toDeduct;
    }

    // Recalculate and sync profiles.card_balance (total unexpired remaining)
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const { data: refreshed } = await adminClient
        .from('card_orders')
        .select('quantity, used, expires_at')
        .eq('user_id', userId)
        .eq('status', 'confirmed');

    const newBalance = (refreshed ?? []).reduce((sum, o) => {
        const rem = o.quantity - o.used;
        if (rem <= 0) return sum;
        if (o.expires_at && o.expires_at < today) return sum;
        return sum + rem;
    }, 0);

    await adminClient
        .from('profiles')
        .update({ card_balance: newBalance })
        .eq('id', userId);

    // Record transaction
    await adminClient.from('card_transactions').insert({
        user_id: userId,
        type: 'deduct',
        amount: -amount,
        balance_after: newBalance,
        enrollment_id: enrollmentId || null,
        note,
        created_by: actorId || null,
    });

    return { success: true, newBalance };
}

/**
 * Recalculate and sync profiles.card_balance from card_orders pools.
 * Call this after any operation that might change pool state.
 */
export async function syncCardBalance(userId: string): Promise<number> {
    const adminClient = createAdminClient();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    const { data: orders } = await adminClient
        .from('card_orders')
        .select('quantity, used, expires_at')
        .eq('user_id', userId)
        .eq('status', 'confirmed');

    const balance = (orders ?? []).reduce((sum, o) => {
        const rem = o.quantity - o.used;
        if (rem <= 0) return sum;
        if (o.expires_at && o.expires_at < today) return sum;
        return sum + rem;
    }, 0);

    await adminClient
        .from('profiles')
        .update({ card_balance: balance })
        .eq('id', userId);

    return balance;
}
