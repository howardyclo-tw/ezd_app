import { createClient, getServerProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from 'next/link';
import { ApprovalsTabsClient } from '@/components/leader/approvals-tabs-client';
import { computeCurrentPeriod, isBlacklisted } from '@/lib/supabase/penalty';
import { isMemberActive, resolvePrice } from '@/lib/supabase/pricing';
import type { BlacklistViolator } from '@/components/leader/approvals-tabs-client';

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
    const courseDetailsByOrder: Record<string, { name: string; teacher: string | null }[]> = {};
    if (allPaymentIds.length > 0) {
        const { data: relatedEnrollments } = await adminDb
            .from('enrollments')
            .select('order_id, courses ( name, teacher )')
            .in('order_id', allPaymentIds);
        for (const e of relatedEnrollments ?? []) {
            if (!e.order_id) continue;
            if (!courseDetailsByOrder[e.order_id]) courseDetailsByOrder[e.order_id] = [];
            const name = (e.courses as any)?.name ?? '';
            const teacher = (e.courses as any)?.teacher ?? null;
            if (name) courseDetailsByOrder[e.order_id].push({ name, teacher });
        }
    }

    // Merge card_purchase + course_fee orders into one list, sorted by created_at desc
    const paymentOrders = [
        ...(cardOrders || []),
        ...(courseFeeOrders || []),
    ].map(o => ({ ...o, courseDetails: courseDetailsByOrder[o.id] ?? [] }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // ------------------------------------------------------------------
    // Blacklist data (Phase 7)
    // ------------------------------------------------------------------
    const taipeiToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    // Fetch all member groups for period computation
    const { data: memberGroups } = await adminDb
        .from('member_groups')
        .select('valid_until');

    const { periodStart, periodEnd } = computeCurrentPeriod(memberGroups ?? [], taipeiToday);

    // Fetch ALL absence records in a single query with course pricing + user profile info
    const { data: allAbsenceRecords } = await adminDb
        .from('attendance_records')
        .select(`
            user_id,
            course_sessions!inner (
                session_date,
                courses!inner (
                    name,
                    pricing_mode,
                    cards_per_session,
                    price_member_single,
                    price_guest_single,
                    price_member_full,
                    price_guest_full,
                    course_sessions ( id )
                )
            ),
            profiles!attendance_records_user_id_fkey (
                name,
                role,
                member_valid_until,
                member_group_id,
                member_groups ( valid_until )
            )
        `)
        .eq('status', 'absent');

    // Fetch existing overrides for this period
    const { data: overrides } = await adminDb
        .from('penalty_overrides')
        .select('user_id')
        .eq('period_end', periodEnd);
    const overrideUserIds = new Set((overrides ?? []).map(o => o.user_id));

    // Group by user + compute violations
    const userAbsences = new Map<string, {
        userName: string;
        absences: { isFree: boolean; sessionDate: string; courseName: string }[];
        isMemberActive: boolean;
    }>();

    for (const rec of allAbsenceRecords ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = rec.course_sessions as any;
        const course = session.courses;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile = rec.profiles as any;
        const sessionDate = session.session_date as string;

        // Filter to records within the penalty period
        if (sessionDate <= periodStart || sessionDate > periodEnd) continue;

        const groupValidUntil = profile?.member_groups?.valid_until ?? null;
        const memberActive = isMemberActive(
            { role: profile?.role ?? 'guest', member_valid_until: profile?.member_valid_until ?? null, groupValidUntil },
            taipeiToday
        );

        const sessionCount = (course.course_sessions as any[])?.length ?? 1;
        const price = resolvePrice({
            pricing_mode: course.pricing_mode,
            cards_per_session: course.cards_per_session,
            price_member_single: course.price_member_single,
            price_guest_single: course.price_guest_single,
            price_member_full: course.price_member_full,
            price_guest_full: course.price_guest_full,
            sessionCount,
        }, memberActive, 'single');

        const isFree = price.kind === 'free';
        if (!isFree) continue; // only care about free-course absences

        const userId = rec.user_id;
        if (!userAbsences.has(userId)) {
            userAbsences.set(userId, {
                userName: profile?.name ?? '未知使用者',
                absences: [],
                isMemberActive: memberActive,
            });
        }
        userAbsences.get(userId)!.absences.push({
            isFree: true,
            sessionDate,
            courseName: course.name,
        });
    }

    // Build violators array (only users with >=1 free-course absence)
    const blacklistViolators: BlacklistViolator[] = [];
    for (const [userId, data] of userAbsences) {
        const absenceCount = data.absences.length; // all are already filtered to free + in-period
        const hasOverride = overrideUserIds.has(userId);
        const blocked = isBlacklisted(absenceCount, hasOverride);
        blacklistViolators.push({
            userId,
            userName: data.userName,
            absenceCount,
            violations: data.absences.map(a => ({
                courseName: a.courseName,
                sessionDate: a.sessionDate,
            })),
            isBlocked: blocked,
            hasOverride,
        });
    }

    // Sort: blocked first, then by absence count descending
    blacklistViolators.sort((a, b) => {
        if (a.isBlocked !== b.isBlocked) return a.isBlocked ? -1 : 1;
        return b.absenceCount - a.absenceCount;
    });

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
                blacklistViolators={blacklistViolators}
                periodEnd={periodEnd}
            />
        </div>
    );
}
