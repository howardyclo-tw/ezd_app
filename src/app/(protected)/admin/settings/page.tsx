import { createClient, getServerProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SystemConfigClient } from '@/components/admin/system-config-client';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
    const { user, profile } = await getServerProfile();

    if (!user) redirect('/login');
    if (profile?.role !== 'admin') redirect('/dashboard');

    const supabase = await createClient();
    const { data: configRows } = await supabase
        .from('system_config')
        .select('key, value')
        .order('key', { ascending: true });

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            <SystemConfigClient
                initialConfig={(configRows ?? []).map(r => ({ key: r.key, value: r.value }))}
            />
        </div>
    );
}
