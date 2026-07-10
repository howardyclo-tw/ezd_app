import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { expireEnrollment } from '@/lib/supabase/actions';
import { redirect } from 'next/navigation';
import { MyCardsClient } from '@/components/dashboard/my-cards-client';
import { isCardWindowOpen } from '@/lib/card-window';
import { sanitizePurchaseUnit } from '@/lib/card-purchase';

export const dynamic = 'force-dynamic';

export default async function MyCardsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Lazy check: expire overdue pending_payment enrollments before rendering
    const adminClient = createAdminClient();
    const { data: overdueEnrollments } = await adminClient
        .from('enrollments')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending_payment')
        .not('payment_deadline_at', 'is', null)
        .lt('payment_deadline_at', new Date().toISOString());

    if (overdueEnrollments && overdueEnrollments.length > 0) {
        for (const e of overdueEnrollments) {
            await expireEnrollment(e.id);
        }
    }

    // Fetch user profile for balance and membership
    const { data: profile } = await supabase
        .from('profiles')
        .select('name, card_balance, role, member_group_id, member_groups ( valid_until )')
        .eq('id', user.id)
        .maybeSingle();

    // Determine membership
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const groupValidUntil = (profile?.member_groups as any)?.valid_until;
    const isMember = profile?.role !== 'guest' &&
        (!groupValidUntil || groupValidUntil >= today);

    // Fetch ALL orders with group title join
    const { data: orders } = await supabase
        .from('orders')
        .select('*, course_groups(title)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    // Fetch system config for pricing and purchase window
    const { data: configRows } = await supabase
        .from('system_config')
        .select('key, value');

    const config: Record<string, string> = {};
    for (const row of configRows ?? []) {
        config[row.key] = row.value;
    }

    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const purchaseMode = config['card_purchase_mode'] ?? 'manual';

    let isPurchaseOpen: boolean;
    if (purchaseMode === 'monthly_first_week') {
        isPurchaseOpen = isCardWindowOpen(todayStr);
    } else {
        // Manual mode (default): existing card_purchase_open + start/end logic
        const purchaseStart = config['card_purchase_start'];
        const purchaseEnd = config['card_purchase_end'];
        isPurchaseOpen = config['card_purchase_open'] === 'true' &&
            (!purchaseStart || purchaseStart.trim() === '' || todayStr >= purchaseStart) &&
            (!purchaseEnd || purchaseEnd.trim() === '' || todayStr <= purchaseEnd);
    }
    const priceMember = parseInt(config['card_price_member'] ?? '270', 10);
    const priceNonMember = parseInt(config['card_price_non_member'] ?? '370', 10);
    const minPurchase = parseInt(config['card_min_purchase'] ?? '5', 10);
    const purchaseUnit = sanitizePurchaseUnit(parseInt(config['card_purchase_unit'] ?? '5', 10));
    const bankInfo = config['bank_info'] ?? '';

    // Build card pools from confirmed card_purchase orders for display
    const cardPurchaseOrders = (orders ?? []).filter(o => o.order_type === 'card_purchase');
    const cardPools = cardPurchaseOrders
        .filter(o => o.status === 'confirmed' && (o.quantity - (o.used ?? 0)) > 0)
        .map(o => ({
            remaining: o.quantity - (o.used ?? 0),
            expires_at: o.expires_at as string | null,
        }))
        .sort((a, b) => (a.expires_at ?? '9999').localeCompare(b.expires_at ?? '9999'));

    // Fetch associated enrollment course names + payment deadline for ALL orders with order_id link
    const allOrderIds = (orders ?? []).map(o => o.id);
    const courseDetailsByOrder: Record<string, { name: string; teacher: string | null }[]> = {};
    const paymentDeadlineByOrder: Record<string, string> = {};
    if (allOrderIds.length > 0) {
        const { data: relatedEnrollments } = await supabase
            .from('enrollments')
            .select('order_id, payment_deadline_at, courses ( name, teacher )')
            .in('order_id', allOrderIds);
        for (const e of relatedEnrollments ?? []) {
            if (!e.order_id) continue;
            if (!courseDetailsByOrder[e.order_id]) courseDetailsByOrder[e.order_id] = [];
            const name = (e.courses as any)?.name ?? '';
            const teacher = (e.courses as any)?.teacher ?? null;
            if (name) courseDetailsByOrder[e.order_id].push({ name, teacher });
            // Track earliest payment deadline for this order
            if (e.payment_deadline_at) {
                const existing = paymentDeadlineByOrder[e.order_id];
                if (!existing || e.payment_deadline_at < existing) {
                    paymentDeadlineByOrder[e.order_id] = e.payment_deadline_at;
                }
            }
        }
    }

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <Suspense fallback={<div className="animate-pulse h-96" />}><MyCardsClient
                balance={profile?.card_balance ?? 0}
                cardPools={cardPools}
                orders={(orders ?? []).map(o => ({
                    id: o.id,
                    order_type: o.order_type,
                    quantity: o.quantity,
                    unit_price: o.unit_price,
                    total_amount: o.total_amount,
                    amount: o.amount,
                    status: o.status,
                    remittance_bank_code: o.remittance_bank_code,
                    remittance_account_last5: o.remittance_account_last5,
                    remittance_date: o.remittance_date,
                    remittance_note: o.remittance_note,
                    expires_at: o.expires_at,
                    created_at: o.created_at,
                    confirmed_at: o.confirmed_at,
                    used: o.used ?? 0,
                    courseDetails: courseDetailsByOrder[o.id] ?? [],
                    groupTitle: (o.course_groups as any)?.title ?? null,
                    courseGroupId: o.course_group_id ?? null,
                    paymentDeadlineAt: paymentDeadlineByOrder[o.id] ?? null,
                }))}
                isPurchaseOpen={isPurchaseOpen}
                priceMember={priceMember}
                priceNonMember={priceNonMember}
                minPurchase={minPurchase}
                purchaseUnit={purchaseUnit}
                isMember={isMember}
                bankInfo={bankInfo}
            /></Suspense>
        </div>
    );
}
