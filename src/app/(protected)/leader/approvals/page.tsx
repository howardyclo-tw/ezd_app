import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import Link from 'next/link';
import { ApprovalsTabsClient } from '@/components/leader/approvals-tabs-client';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export default async function LeaderApprovalsPage() {
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

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

    // Fetch Card Orders (Pending / Remitted)
    const cardOrderQuery = supabase.from('card_orders')
        .select('*, profiles!card_orders_user_id_fkey(name)')
        .in('status', ['pending', 'remitted'])
        .order('created_at', { ascending: false });

    // Fetch Recent Leaves
    const leaveQuery = supabase
        .from('leave_requests')
        .select(`
            *,
            profiles!leave_requests_user_id_fkey(name),
            courses(name, course_groups(title)),
            course_sessions(session_date, session_number)
        `)
        .gte('created_at', thirtyDaysAgoIso)
        .order('created_at', { ascending: false });

    // Fetch Recent Makeups
    const makeupQuery = supabase
        .from('makeup_requests')
        .select(`
            *,
            profiles!makeup_requests_user_id_fkey(name),
            original_courses:original_course_id(name, course_groups(title)),
            target_courses:target_course_id(name, course_groups(title)),
            target_sessions:target_session_id(session_date, session_number)
        `)
        .gte('created_at', thirtyDaysAgoIso)
        .order('created_at', { ascending: false });

    // Fetch Recent Transfers
    const transferQuery = supabase
        .from('transfer_requests')
        .select(`
            *,
            from_profile:from_user_id(name),
            to_profile:to_user_id(name),
            courses(name, course_groups(title)),
            course_sessions(session_date, session_number)
        `)
        .gte('created_at', thirtyDaysAgoIso)
        .order('created_at', { ascending: false });

    const [
        { data: cardOrders },
        { data: leaves },
        { data: makeups },
        { data: transfers }
    ] = await Promise.all([cardOrderQuery, leaveQuery, makeupQuery, transferQuery]);

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-9 w-9 -ml-2 shrink-0">
                        <Link href="/dashboard"><ChevronLeft className="h-5 w-5" /></Link>
                    </Button>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight leading-tight">申請審核</h1>
                        <p className="text-sm text-muted-foreground font-medium mt-0.5">
                            核對堂卡匯款與檢視請假、補課、轉讓等系統自動化紀錄
                        </p>
                    </div>
                </div>
            </div>

            <ApprovalsTabsClient
                cardOrders={cardOrders || []}
                leaves={leaves || []}
                makeups={makeups || []}
                transfers={transfers || []}
                currentUserId={user.id}
            />
        </div>
    );
}
