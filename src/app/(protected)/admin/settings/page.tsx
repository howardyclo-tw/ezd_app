import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SystemConfigClient } from '@/components/admin/system-config-client';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.role !== 'admin') {
        redirect('/dashboard');
    }

    // Fetch all system config entries
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
