import { getServerProfile } from '@/lib/supabase/server';
import { getSystemConfigValue } from '@/lib/supabase/queries';
import { redirect } from 'next/navigation';
import { GuidePageClient } from './guide-page-client';

export const dynamic = 'force-dynamic';

export default async function GuidePage() {
    const { user, profile } = await getServerProfile();
    if (!user) redirect('/login');

    const markdown = await getSystemConfigValue('user_guide') ?? '';
    const isAdmin = profile?.role === 'admin';

    return <GuidePageClient initialMarkdown={markdown} isAdmin={isAdmin} />;
}
