import { Button } from "@/components/ui/button";
import { CourseCard } from "@/components/courses/course-card";
import { ChevronLeft, Calendar as CalendarIcon, Edit2, Plus, UserPlus } from "lucide-react";
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { GroupEnrollmentDialog } from "@/components/courses/group-enrollment-dialog";

export const dynamic = 'force-dynamic';

// Helper: compute course status for display
function getCourseDisplayStatus(course: any): string {
    if (course.status === 'closed') return 'ended';
    if (course.status === 'draft') return 'upcoming';

    const now = new Date();
    const enrollStart = course.enrollment_start_at ? new Date(course.enrollment_start_at) : null;
    const enrollEnd = course.enrollment_end_at ? new Date(course.enrollment_end_at) : null;

    if (enrollStart && enrollStart > now) return 'upcoming';
    if (enrollEnd && enrollEnd < now) return 'ended';

    const enrolledCount = (course.enrollments as any[])?.[0]?.count ?? 0;
    if (enrolledCount >= course.capacity) return 'full';
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

    // Fetch courses in this group
    const { data: courses } = await supabase
        .from('courses')
        .select(`
            *,
            course_sessions ( id, session_date, session_number ),
            enrollments ( count ),
            course_leaders ( user_id, profiles!course_leaders_user_id_fkey ( id, name ) )
        `)
        .eq('group_id', groupData.id)
        .order('start_time');

    // Fetch user's existing enrollments for this group (to disable in dialog)
    const { data: userEnrollments } = await supabase
        .from('enrollments')
        .select('course_id')
        .eq('user_id', user.id)
        .eq('status', 'enrolled')
        .eq('type', 'full');

    // Infer period from group data
    const inferredPeriod = groupData.period_start && groupData.period_end
        ? `${groupData.period_start.replace(/-/g, '/')}~${groupData.period_end.replace(/-/g, '/')}`
        : '檔期時間未定';

    // Map courses to CourseCard format
    const courseCards = (courses ?? []).map(course => {
        const sessions = (course.course_sessions as any[]) ?? [];
        const firstSession = sessions.sort((a: any, b: any) => a.session_date.localeCompare(b.session_date))[0];
        const lastSession = sessions[sessions.length - 1];

        const cShortId = course.slug || course.id;
        const gShortId = groupData.slug || groupData.id;

        const enrolledCount = (course.enrollments as any[])?.[0]?.count ?? 0;
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
            status: getCourseDisplayStatus(course),
            capacity: course.capacity,
            enrolledCount: enrolledCount,
            startDate: firstSession?.session_date ?? '',
            endDate: lastSession?.session_date ?? '',
        };
    });

    // Check registration status
    const now = new Date();
    const isPhase1Expired = groupData.registration_phase1_end && new Date(groupData.registration_phase1_end) < now;

    // Format registration phase 1 display
    const renderPhase1Period = () => {
        if (!groupData.registration_phase1_start || !groupData.registration_phase1_end) return null;
        const start = new Date(groupData.registration_phase1_start);
        const end = new Date(groupData.registration_phase1_end);

        // e.g. "02/20~02/25"
        const formatShortDate = (d: Date) =>
            `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        return `${formatShortDate(start)}~${formatShortDate(end)}`;
    };

    const phase1Text = renderPhase1Period();

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
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto mt-4 sm:mt-0">
                    <GroupEnrollmentDialog
                        groupTitle={groupData.title}
                        cardBalance={profile?.card_balance ?? 0}
                        courses={(courses ?? []).map(c => {
                            const sessions = (c.course_sessions as any[]) ?? [];
                            const enrolledCount = (c.enrollments as any[])?.[0]?.count ?? 0;
                            const isUserEnrolled = (userEnrollments ?? []).some(ue => ue.course_id === c.id);

                            return {
                                id: c.id,
                                name: c.name,
                                teacher: c.teacher,
                                sessionsCount: sessions.length,
                                cardsPerSession: c.cards_per_session,
                                isEnrolled: isUserEnrolled,
                                isFull: enrolledCount >= c.capacity,
                            };
                        })}
                    />
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
