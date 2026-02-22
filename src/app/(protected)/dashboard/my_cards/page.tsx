import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { MyCardsClient } from '@/components/dashboard/my-cards-client';

export const dynamic = 'force-dynamic';

export default async function MyCardsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Fetch user profile for balance and membership
    const { data: profile } = await supabase
        .from('profiles')
        .select('name, card_balance, role, member_valid_until')
        .eq('id', user.id)
        .maybeSingle();

    // Determine membership
    const isMember = profile?.role !== 'guest' &&
        (!profile?.member_valid_until || new Date(profile.member_valid_until) >= new Date());

    // Fetch card orders
    const { data: orders } = await supabase
        .from('card_orders')
        .select('*')
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

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const purchaseStart = config['card_purchase_start'];
    const purchaseEnd = config['card_purchase_end'];

    const isPurchaseOpen = config['card_purchase_open'] === 'true' &&
        (!purchaseStart || purchaseStart.trim() === '' || todayStr >= purchaseStart) &&
        (!purchaseEnd || purchaseEnd.trim() === '' || todayStr <= purchaseEnd);
    const priceMember = parseInt(config['card_price_member'] ?? '270', 10);
    const priceNonMember = parseInt(config['card_price_non_member'] ?? '370', 10);
    const minPurchase = parseInt(config['card_min_purchase'] ?? '5', 10);
    const bankInfo = config['bank_info'] ?? '';

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <MyCardsClient
                balance={profile?.card_balance ?? 0}
                orders={(orders ?? []).map(o => ({
                    id: o.id,
                    quantity: o.quantity,
                    unit_price: o.unit_price,
                    total_amount: o.total_amount,
                    status: o.status,
                    remittance_account_last5: o.remittance_account_last5,
                    remittance_date: o.remittance_date,
                    remittance_note: o.remittance_note,
                    expires_at: o.expires_at,
                    created_at: o.created_at,
                    confirmed_at: o.confirmed_at,
                }))}
                isPurchaseOpen={isPurchaseOpen}
                priceMember={priceMember}
                priceNonMember={priceNonMember}
                minPurchase={minPurchase}
                isMember={isMember}
                bankInfo={bankInfo}
            />
        </div>
    );
}
