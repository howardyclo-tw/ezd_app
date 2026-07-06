import { createClient, getServerProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from 'next/link';
import { ApprovalsTabsClient } from '@/components/leader/approvals-tabs-client';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export default async function LeaderApprovalsPage() {
    const { user, profile } = await getServerProfile();

    if (!user) redirect('/login');
    if (profile?.role !== 'admin') redirect('/dashboard');

    const supabase = await createClient();
    const adminDb = createAdminClient();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

    // Fetch Recent Card Orders (include course_groups join for grouping)
    const cardOrderQuery = supabase.from('orders')
        .select('*, profiles!card_orders_user_id_fkey(name), course_groups(title, registration_phase1_end)')
        .eq('order_type', 'card_purchase')
        .gte('created_at', thirtyDaysAgoIso)
        .order('created_at', { ascending: false });

    // Fetch Recent Course Fee Orders (with course group title + phase1 end for grouping)
    const courseFeeOrderQuery = adminDb.from('orders')
        .select('*, profiles!card_orders_user_id_fkey(name), course_groups(title, registration_phase1_end)')
        .eq('order_type', 'course_fee')
        .gte('created_at', thirtyDaysAgoIso)
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

    // Fetch Recent Single Enrollments (use adminClient for cross-user SELECT)
    const singleEnrollmentQuery = adminDb
        .from('enrollments')
        .select(`
            *,
            profiles!enrollments_user_id_fkey(name),
            courses(name, course_groups(title)),
            course_sessions!enrollments_session_id_fkey(session_date, session_number)
        `)
        .eq('type', 'single')
        .in('status', ['enrolled', 'cancelled'])
        .gte('enrolled_at', thirtyDaysAgoIso)
        .order('enrolled_at', { ascending: false });

    // Start all queries in parallel
    const [
        { data: cardOrders },
        { data: courseFeeOrders },
        { data: leaves },
        { data: makeups },
        { data: transfers },
        { data: singleEnrollments }
    ] = await Promise.all([cardOrderQuery, courseFeeOrderQuery, leaveQuery, makeupQuery, transferQuery, singleEnrollmentQuery]);

    // Fetch associated enrollment course names for ALL payment orders
    const allPaymentIds = [...(cardOrders || []), ...(courseFeeOrders || [])].map(o => o.id);
    const courseNamesByOrder: Record<string, string[]> = {};
    if (allPaymentIds.length > 0) {
        const { data: relatedEnrollments } = await adminDb
            .from('enrollments')
            .select('order_id, courses ( name )')
            .in('order_id', allPaymentIds);
        for (const e of relatedEnrollments ?? []) {
            if (!e.order_id) continue;
            if (!courseNamesByOrder[e.order_id]) courseNamesByOrder[e.order_id] = [];
            const courseName = (e.courses as any)?.name;
            if (courseName) courseNamesByOrder[e.order_id].push(courseName);
        }
    }

    // Merge card_purchase + course_fee orders into one list, sorted by created_at desc
    const paymentOrders = [
        ...(cardOrders || []),
        ...(courseFeeOrders || []),
    ].map(o => ({ ...o, courseNames: courseNamesByOrder[o.id] ?? [] }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground">
                        <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">申請審核</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">
                                核對堂卡匯款與檢視請假、補課、轉讓等系統自動化紀錄
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <ApprovalsTabsClient
                paymentOrders={paymentOrders}
                leaves={leaves || []}
                makeups={makeups || []}
                transfers={transfers || []}
                singleEnrollments={singleEnrollments || []}
                currentUserId={user.id}
            />
        </div>
    );
}
