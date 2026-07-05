import { Button } from "@/components/ui/button";
import { createAdminClient } from '@/lib/supabase/admin';
import { computeSessionOccupancy } from '@/lib/supabase/capacity';
import { CourseCard } from "@/components/courses/course-card";
import { RegistrationWindowEdit } from "@/components/courses/registration-window-edit";
import { ChevronLeft, Calendar as CalendarIcon, UserPlus } from "lucide-react";
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { formatTaipeiDateTime } from '@/lib/date';

export const dynamic = 'force-dynamic';

// Helper: compute course status for display
function getCourseDisplayStatus(course: any, maxOccupancy: number): string {
    const now = new Date();
    const enrollStart = course.enrollment_start_at ? new Date(course.enrollment_start_at) : null;
    const enrollEnd = course.enrollment_end_at ? new Date(course.enrollment_end_at) : null;

    if (enrollStart && enrollStart > now) return 'upcoming';
    if (enrollEnd && enrollEnd < now) return 'ended';

    if (maxOccupancy >= course.capacity) return 'full';
    return 'open';
}

// Helper: format time to display string like "週一 19:00-20:30"
function formatCourseTime(course: any, sessions: any[]): string {
    if (!sessions?.length) return `${course.start_time?.slice(0, 5)}-${course.end_time?.slice(0, 5)}`;

    const firstDate = new Date(sessions[0].session_date);
    const dayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const dayName = dayNames[firstDate.getDay()];
    return `${dayName} ${course.start_time?.slice(0, 5)}-${course.end_time?.slice(0, 5)}`;
}

export default async function CourseGroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = await params;
    const supabase = await createClient();

    // Check user role
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, card_balance')
        .eq('id', user.id)
        .maybeSingle();

    const isAdminOrLeader = profile?.role === 'admin' || profile?.role === 'leader';

    // Fetch group by ID or slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId);
    const groupQuery = supabase.from('course_groups').select('*');
    if (isUuid) {
        groupQuery.or(`id.eq.${groupId},slug.eq.${groupId}`);
    } else {
        groupQuery.eq('slug', groupId);
    }
    const { data: groupData } = await groupQuery.maybeSingle();

    if (!groupData) notFound();

    // Auto-fix URL: If accessed via UUID but has a slug, redirect to slug
    if (isUuid && groupData.slug && groupData.slug !== groupId) {
        redirect(`/courses/groups/${groupData.slug}`);
    }

    // Fetch courses, user enrollments in parallel (both depend on groupData.id)
    const [
        { data: courses },
        { data: userEnrollments },
    ] = await Promise.all([
        // Courses in this group
        supabase
            .from('courses')
            .select(`
                *,
                course_sessions ( id, session_date, session_number ),
                course_leaders ( user_id, profiles!course_leaders_user_id_fkey ( id, name ) )
            `)
            .eq('group_id', groupData.id),

        // User's existing active enrollments for this group (full-term)
        supabase
            .from('enrollments')
            .select('course_id')
            .eq('user_id', user.id)
            .eq('type', 'full')
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']),
    ]);

    // Compute max session occupancy per course for accurate isFull check
    const adminDb = createAdminClient();
    const allCourseIds = (courses ?? []).map(c => c.id);
    const allSessionIds = (courses ?? []).flatMap(c => (c.course_sessions as any[])?.map((s: any) => s.id) ?? []);

    const [
        { data: allEnrollments },
        { data: allMakeups },
        { data: allLeaves },
        { data: allTransfers },
    ] = allSessionIds.length > 0 ? await Promise.all([
        adminDb.from('enrollments').select('course_id, type, status, session_id').in('status', ['enrolled', 'pending_payment', 'pending_vote']).in('course_id', allCourseIds),
        adminDb.from('makeup_requests').select('target_session_id').eq('status', 'approved').in('target_session_id', allSessionIds),
        adminDb.from('leave_requests').select('session_id').eq('status', 'approved').in('session_id', allSessionIds),
        adminDb.from('transfer_requests').select('session_id, to_user_id').eq('status', 'approved').in('session_id', allSessionIds),
    ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

    // Build lookup maps for attendance deltas (O(n) each)
    const makeupCountBySession: Record<string, number> = {};
    (allMakeups ?? []).forEach((m: any) => { makeupCountBySession[m.target_session_id] = (makeupCountBySession[m.target_session_id] ?? 0) + 1; });

    const leaveCountBySession: Record<string, number> = {};
    (allLeaves ?? []).forEach((l: any) => { leaveCountBySession[l.session_id] = (leaveCountBySession[l.session_id] ?? 0) + 1; });

    const transferInBySession: Record<string, number> = {};
    const transferOutBySession: Record<string, number> = {};
    (allTransfers ?? []).forEach((t: any) => {
        transferOutBySession[t.session_id] = (transferOutBySession[t.session_id] ?? 0) + 1;
        if (t.to_user_id) transferInBySession[t.session_id] = (transferInBySession[t.session_id] ?? 0) + 1;
    });

    // Group enrollments by course_id for efficient per-course filtering
    const enrollmentsByCourse: Record<string, any[]> = {};
    (allEnrollments ?? []).forEach((e: any) => {
        if (!enrollmentsByCourse[e.course_id]) enrollmentsByCourse[e.course_id] = [];
        enrollmentsByCourse[e.course_id].push(e);
    });

    // Compute max occupancy per course using computeSessionOccupancy
    const courseMaxOccupancy: Record<string, number> = {};
    for (const course of (courses ?? [])) {
        const sessions = (course.course_sessions as any[]) ?? [];
        const courseEnrollments = enrollmentsByCourse[course.id] ?? [];

        let maxOcc = 0;
        for (const s of sessions) {
            const occ = computeSessionOccupancy({
                enrollments: courseEnrollments,
                sessionId: s.id,
                makeupCount: makeupCountBySession[s.id] ?? 0,
                transferInCount: transferInBySession[s.id] ?? 0,
                leaveCount: leaveCountBySession[s.id] ?? 0,
                transferOutCount: transferOutBySession[s.id] ?? 0,
            });
            if (occ > maxOcc) maxOcc = occ;
        }
        courseMaxOccupancy[course.id] = maxOcc;
    }

    // Map courses to CourseCard format
    let minDate: string | null = null;
    let maxDate: string | null = null;

    const courseCards = (courses ?? []).map(course => {
        const sessions = (course.course_sessions as any[]) ?? [];
        sessions.sort((a: any, b: any) => a.session_date.localeCompare(b.session_date));

        const firstSession = sessions[0];
        const lastSession = sessions[sessions.length - 1];

        // Track overall min/max dates from courses
        if (firstSession?.session_date) {
            if (!minDate || firstSession.session_date < minDate) minDate = firstSession.session_date;
        }
        if (lastSession?.session_date) {
            if (!maxDate || lastSession.session_date > maxDate) maxDate = lastSession.session_date;
        }

        const cShortId = course.slug || course.id;
        const gShortId = groupData.slug || groupData.id;

        const enrolledCount = courseMaxOccupancy[course.id] ?? 0;
        const timeDisplay = firstSession
            ? `${firstSession.session_date.slice(5).replace('-', '/')} (${formatCourseTime(course, [firstSession]).split(' ')[0]}) ${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)} • ${sessions.length} 堂`
            : `${formatCourseTime(course, sessions)} • ${sessions.length} 堂`;

        return {
            id: cShortId,
            href: `/courses/groups/${gShortId}/${cShortId}`,
            name: course.name,
            teacher: course.teacher,
            time: timeDisplay,
            location: course.room,
            type: course.type,
            status: getCourseDisplayStatus(course, courseMaxOccupancy[course.id] ?? 0),
            capacity: course.capacity,
            enrolledCount: enrolledCount,
            startDate: firstSession?.session_date ?? '',
            endDate: lastSession?.session_date ?? '',
            startTime: course.start_time ?? '',
        };
    }).sort((a, b) => {
        // Sort by day-of-week (Mon=1 ... Sun=7), then by start time, then by name
        const dayA = a.startDate ? (new Date(a.startDate + 'T00:00:00').getDay() || 7) : 8;
        const dayB = b.startDate ? (new Date(b.startDate + 'T00:00:00').getDay() || 7) : 8;
        if (dayA !== dayB) return dayA - dayB;
        if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
        return a.name.localeCompare(b.name);
    });

    // Final Period string calculation: fallback to groupData if courses are missing or don't have dates
    const finalMin = minDate || groupData.period_start;
    const finalMax = maxDate || groupData.period_end;

    const formattedMin = finalMin ? (finalMin as string).replace(/-/g, '/') : null;
    const formattedMax = finalMax ? (finalMax as string).replace(/-/g, '/') : null;
    const inferredPeriod = formattedMin && formattedMax
        ? `${formattedMin}~${formattedMax}`
        : (formattedMin || formattedMax || '檔期時間未定');

    // Registration window state machine
    const now = new Date();
    const hasWindow = !!(groupData.registration_phase1_start && groupData.registration_phase1_end);
    const windowStart = groupData.registration_phase1_start ? new Date(groupData.registration_phase1_start) : null;
    const windowEnd = groupData.registration_phase1_end ? new Date(groupData.registration_phase1_end) : null;

    type WindowState = 'not_configured' | 'not_started' | 'open' | 'closed';
    let windowState: WindowState;
    if (!hasWindow) windowState = 'not_configured';
    else if (now < windowStart!) windowState = 'not_started';
    else if (now > windowEnd!) windowState = 'closed';
    else windowState = 'open';

    const hasExistingEnrollment = (userEnrollments ?? []).length > 0;
    const hasOpenSingleEnroll = (courses ?? []).some((c: any) => c.enroll_single === true);
    const gSlug = groupData.slug || groupData.id;

    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-9 w-9 -ml-2 shrink-0">
                        <Link href="/courses"><ChevronLeft className="h-5 w-5" /></Link>
                    </Button>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight leading-tight">{groupData.title}</h1>
                        <p className="text-sm text-muted-foreground font-medium flex items-center gap-1.5 mt-0.5">
                            <CalendarIcon className="h-3.5 w-3.5" /> {inferredPeriod}
                        </p>
                        {/* Admin: registration window info */}
                        {isAdminOrLeader && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                                {hasWindow ? (
                                    <>
                                        報名時段：{formatTaipeiDateTime(groupData.registration_phase1_start!)} ~ {formatTaipeiDateTime(groupData.registration_phase1_end!)}
                                        <RegistrationWindowEdit
                                            groupId={groupData.id}
                                            groupTitle={groupData.title}
                                            currentStart={groupData.registration_phase1_start}
                                            currentEnd={groupData.registration_phase1_end}
                                        />
                                    </>
                                ) : (
                                    <>
                                        <span className="text-amber-600 dark:text-amber-400">尚未設定報名時段</span>
                                        <RegistrationWindowEdit
                                            groupId={groupData.id}
                                            groupTitle={groupData.title}
                                            currentStart={null}
                                            currentEnd={null}
                                        />
                                    </>
                                )}
                            </p>
                        )}
                    </div>
                </div>

                {/* Enrollment CTA — window-driven lifecycle */}
                <div className="flex flex-col items-end gap-1 w-full sm:w-auto mt-4 sm:mt-0">
                    {windowState === 'not_configured' && !isAdminOrLeader ? null : (
                        windowState === 'not_configured' && isAdminOrLeader ? (
                            <span className="text-xs text-muted-foreground">設定報名時段後,學員將可看到報名按鈕</span>
                        ) : windowState === 'not_started' ? (
                            <Button
                                size="lg"
                                disabled
                                className="w-full sm:w-auto font-bold rounded-xl px-6 h-11 flex items-center gap-2.5 opacity-60"
                            >
                                <UserPlus className="h-5 w-5 stroke-[2.5]" />
                                <span>整期報名 {formatTaipeiDateTime(groupData.registration_phase1_start!)} 開放</span>
                            </Button>
                        ) : windowState === 'open' ? (
                            <Button
                                size="lg"
                                asChild
                                className="w-full sm:w-auto font-bold bg-primary hover:bg-primary/90 text-primary-foreground border-none transition-all active:scale-95 rounded-xl px-6 h-11 flex items-center gap-2.5 shadow-lg shadow-primary/20"
                            >
                                <Link href={`/courses/groups/${gSlug}/register`}>
                                    <UserPlus className="h-5 w-5 stroke-[2.5]" />
                                    <span>{hasExistingEnrollment ? '查看/修改報名' : '整期報名'}</span>
                                </Link>
                            </Button>
                        ) : /* closed */ (
                            <div className="flex flex-col items-end gap-1">
                                <Button
                                    size="lg"
                                    disabled
                                    className="w-full sm:w-auto font-bold rounded-xl px-6 h-11 flex items-center gap-2.5 opacity-60"
                                >
                                    <UserPlus className="h-5 w-5 stroke-[2.5]" />
                                    <span>整期報名已截止</span>
                                </Button>
                                {hasOpenSingleEnroll && (
                                    <span className="text-xs text-muted-foreground">單堂加報請至各課程頁</span>
                                )}
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Course List */}
            {courseCards.length > 0 ? (
                <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                    {courseCards.map((course) => (
                        <CourseCard key={course.id} course={course} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-24 border-2 border-dashed border-muted rounded-2xl bg-muted/5">
                    <p className="text-muted-foreground text-sm font-semibold italic">此檔期尚無課程</p>
                </div>
            )}
        </div>
    );
}
