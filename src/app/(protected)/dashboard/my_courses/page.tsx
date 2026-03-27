import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ChevronLeft, Calendar } from 'lucide-react';
import { getAvailableMakeupQuotaSessions } from '@/lib/supabase/queries';
import { MyCoursesClient } from '@/components/dashboard/my-courses-client';

export const dynamic = 'force-dynamic';

export default async function MyCoursesPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // ── 1. Upcoming: enrolled sessions with future dates ──
    // Use Asia/Taipei timezone to match user's local date
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    // Fetch all data in parallel
    const [{ data: myEnrollments }, { data: attendanceRecords }, { data: myMakeupRequests }, { data: myTransferIns }] = await Promise.all([
        supabase
            .from('enrollments')
            .select(`
                id, status, type, session_id, waitlist_position,
                courses (
                    id, name, teacher, start_time, end_time, room, type, capacity, slug,
                    course_groups ( id, title, slug ),
                    course_sessions ( id, session_date, session_number )
                )
            `)
            .eq('user_id', user.id)
            .in('status', ['enrolled', 'waitlist']),
        supabase
            .from('attendance_records')
            .select(`
                status,
                course_sessions (
                    id, session_date, session_number,
                    courses (
                        id, slug, name, teacher, start_time, end_time, room, type, capacity,
                        course_groups ( id, slug, title )
                    )
                )
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        supabase
            .from('makeup_requests')
            .select('target_session_id')
            .eq('user_id', user.id)
            .eq('status', 'approved'),
        supabase
            .from('transfer_requests')
            .select('session_id, to_user_id')
            .eq('to_user_id', user.id)
            .eq('status', 'approved'),
    ]);

    // Authoritative source maps (survive attendance overwrites)
    const makeupSessionIds = new Set((myMakeupRequests ?? []).map(m => m.target_session_id));
    const transferInSessionIds = new Set((myTransferIns ?? []).map(t => t.session_id));

    // Maps to keep track of attendance statuses for upcoming logic
    // We use a Map of counts because a user might have multiple enrollments (slots) for one session.
    // If they take leave for 1 slot, we only hide 1 card, not all of them.
    const excludeCountMap = new Map<string, number>();
    const extraUpcomingSessions: any[] = [];
    const historyRecords: any[] = [];

    (attendanceRecords ?? []).forEach((r: any) => {
        const session = r.course_sessions;
        if (!session) return;

        const course = session.courses;
        if (!course) return;

        const group = course.course_groups;
        const gId = group?.slug || group?.id;
        const cId = course?.slug || course?.id;

        // Determine status for display — use authoritative source over attendance status
        const sessionId = session.id;
        let simpleStatus: any = 'present';
        if (r.status === 'leave') simpleStatus = 'leave';
        else if (r.status === 'transfer_out') simpleStatus = 'transfer_out';
        else if (makeupSessionIds.has(sessionId)) simpleStatus = 'makeup';
        else if (transferInSessionIds.has(sessionId)) simpleStatus = 'transfer_in';
        else if (r.status === 'absent') simpleStatus = 'absent';
        else if (r.status === 'makeup') simpleStatus = 'makeup';
        else if (r.status === 'transfer_in') simpleStatus = 'transfer_in';
        else if (r.status === 'unmarked') simpleStatus = 'enrolled';
        else simpleStatus = 'present';

        const recordItem = {
            groupTitle: group?.title ?? '未知檔期',
            courseName: course.name,
            teacher: course.teacher,
            date: session.session_date,
            sessionNumber: session.session_number ?? 0,
            status: simpleStatus,
            href: (gId && cId) ? `/courses/groups/${gId}/${cId}` : undefined,
        };

        const isPast = session.session_date < today;
        const isSettledAction = r.status === 'leave' || r.status === 'transfer_out';

        // 歷史紀錄顯示邏輯：已經過去的課堂 OR 雖然在未來但已經處理完畢的動作 (請假、轉讓出去)
        if (session.session_date && (isPast || isSettledAction)) {
            historyRecords.push(recordItem);
        }

        // ── Upcoming 顯示邏輯：
        // 1. 已處理的排除 (請假、轉讓出去)
        if (r.status === 'leave' || r.status === 'transfer_out') {
            excludeCountMap.set(session.id, (excludeCountMap.get(session.id) || 0) + 1);
        }
        // 2. 補課/轉入/非報名但有紀錄的學員 (僅限未來)
        else if (['makeup', 'transfer_in', 'unmarked', 'present'].includes(r.status) && session.session_date >= today) {
            extraUpcomingSessions.push({
                groupTitle: group?.title ?? '未知檔期',
                courseName: course.name,
                teacher: course.teacher,
                date: session.session_date,
                time: `${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)}`,
                room: course.room,
                sessionNumber: session.session_number ?? 0,
                status: makeupSessionIds.has(sessionId) ? 'makeup' : transferInSessionIds.has(sessionId) ? 'transfer_in' : 'enrolled',
                href: (gId && cId) ? `/courses/groups/${gId}/${cId}` : undefined,
                sessionId: session.id
            });
        }
    });

    historyRecords.sort((a, b) => b.date.localeCompare(a.date));

    const upcomingSessions = (myEnrollments ?? []).flatMap((enrollment: any) => {
        const course = enrollment.courses;
        if (!course) return [];

        const group = course.course_groups;
        const sessions = (course.course_sessions ?? [])
            .slice()
            .sort((a: any, b: any) => a.session_date.localeCompare(b.session_date));

        const gId = group?.slug || group?.id;
        const cId = course?.slug || course?.id;

        return sessions
            .filter((s: any) => {
                if (enrollment.type === 'single' && s.id !== enrollment.session_id) return false;
                if (s.session_date < today) return false;
                
                // One-to-one exclusion logic:
                const excludesLeft = excludeCountMap.get(s.id) || 0;
                if (excludesLeft > 0) {
                    excludeCountMap.set(s.id, excludesLeft - 1);
                    return false;
                }
                return true;
            })
            .map((s: any) => {
                const sessionIndex = sessions.findIndex((ps: any) => ps.id === s.id);
                return {
                    groupTitle: group?.title ?? '未知檔期',
                    courseName: course.name,
                    teacher: course.teacher,
                    date: s.session_date,
                    time: `${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)}`,
                    room: course.room,
                    sessionNumber: sessionIndex + 1,
                    status: enrollment.status === 'waitlist' ? 'waitlist' : 'enrolled',
                    waitlistPosition: enrollment.waitlist_position ?? undefined,
                    href: (gId && cId) ? `/courses/groups/${gId}/${cId}` : undefined,
                    sessionId: s.id,
                };
            });
    });

    // Merge extra sessions into upcoming, deduplicating by sessionId
    const existingSessionIds = new Set(upcomingSessions.map((s: any) => s.sessionId).filter(Boolean));
    for (const extra of extraUpcomingSessions) {
        if (!existingSessionIds.has(extra.sessionId)) {
            upcomingSessions.push(extra);
            existingSessionIds.add(extra.sessionId);
        }
    }

    upcomingSessions.sort((a: any, b: any) => a.date.localeCompare(b.date));

    // ── 3. Makeup: Group available missed sessions by course group ──
    const { sessions: availableSessions, manualQuota } = await getAvailableMakeupQuotaSessions(user.id);

    // Grouping logic: calculate actual available count per group
    const groupMakeupMap = new Map<string, { title: string, count: number, slug: string }>();

    // First, we need to track counts per course to respect per-course quota
    const perCourseStats = new Map<string, { absences: number, totalQuota: number, usedQuota: number }>();
    availableSessions.forEach((s: any) => {
        const stats = perCourseStats.get(s.courseId) || { absences: 0, totalQuota: s.totalQuota, usedQuota: s.usedQuota };
        stats.absences += 1;
        perCourseStats.set(s.courseId, stats);
    });

    // Now, calculate the spendable makeup sessions for each course and aggregate by group
    availableSessions.forEach((s: any) => {
        const groupKey = s.groupId;
        if (!groupMakeupMap.has(groupKey)) {
            groupMakeupMap.set(groupKey, { title: s.groupTitle, count: 0, slug: s.groupSlug || s.groupId });
        }
    });

    // For each course, add its spendable count to its group
    perCourseStats.forEach((stats, courseId) => {
        const spendable = Math.min(stats.absences, Math.max(0, stats.totalQuota - stats.usedQuota));
        if (spendable > 0) {
            // Find which group this course belongs to
            const sampleSession = availableSessions.find((s: any) => s.courseId === courseId);
            if (sampleSession) {
                const groupData = groupMakeupMap.get(sampleSession.groupId);
                if (groupData) groupData.count += spendable;
            }
        }
    });

    const makeupGroups = Array.from(groupMakeupMap.values())
        .filter(g => g.count > 0)
        .map(g => ({
            id: g.slug,
            title: g.title,
            count: g.count,
            href: `/courses/groups/${g.slug}`
        }));

    let availableMakeupQuotaCount = makeupGroups.reduce((sum, g) => sum + g.count, 0) + manualQuota;

    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0">
                        <Link href="/dashboard">
                            <ChevronLeft className="h-6 w-6" />
                        </Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <Calendar className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">我的課程</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">
                                管理您的課表與出席紀錄 <span className="text-[11px] opacity-60 ml-1">(請假/轉讓請點選課程頁面申請)</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <MyCoursesClient
                upcomingSessions={upcomingSessions}
                historyRecords={historyRecords}
                makeupGroups={makeupGroups}
                availableMakeupQuotaCount={availableMakeupQuotaCount}
                manualQuota={manualQuota}
            />
        </div>
    );
}
