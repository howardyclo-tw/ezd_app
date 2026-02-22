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
    const { data: myEnrollments } = await supabase
        .from('enrollments')
        .select(`
            id,
            status,
            waitlist_position,
            courses (
                id, name, teacher, start_time, end_time, room, type, status, capacity, slug,
                course_groups ( id, title, slug ),
                course_sessions ( id, session_date, session_number )
            )
        `)
        .eq('user_id', user.id)
        .in('status', ['enrolled', 'waitlist']);

    const today = new Date().toISOString().slice(0, 10);

    const upcomingSessions = (myEnrollments ?? []).flatMap((enrollment: any) => {
        const course = enrollment.courses;
        const group = course.course_groups;
        const sessions = course.course_sessions ?? [];

        const gId = group?.slug || group?.id;
        const cId = course?.slug || course?.id;

        return sessions
            .filter((s: any) => s.session_date >= today)
            .map((s: any) => ({
                groupTitle: group?.title ?? '未知檔期',
                courseName: course.name,
                teacher: course.teacher,
                date: s.session_date,
                time: `${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)}`,
                room: course.room,
                sessionNumber: s.session_number,
                status: enrollment.status as 'enrolled' | 'waitlist',
                waitlistPosition: enrollment.waitlist_position ?? undefined,
                href: (gId && cId) ? `/courses/groups/${gId}/${cId}` : undefined,
            }));
    }).sort((a: any, b: any) => a.date.localeCompare(b.date));

    // ── 2. History: attendance records ──
    const { data: attendanceRecords } = await supabase
        .from('attendance_records')
        .select(`
            status,
            course_sessions (
                id, session_date, session_number,
                courses (
                    id, slug, name, teacher,
                    course_groups ( id, slug, title )
                )
            )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    const historyRecords = (attendanceRecords ?? []).map((r: any) => {
        const session = r.course_sessions;
        const course = session?.courses;
        const group = course?.course_groups;

        const gId = group?.slug || group?.id;
        const cId = course?.slug || course?.id;

        // Simplify status to: present / absent / leave
        let simpleStatus: 'present' | 'absent' | 'leave' = 'present';
        if (r.status === 'absent') simpleStatus = 'absent';
        else if (r.status === 'leave') simpleStatus = 'leave';
        else if (r.status === 'present' || r.status === 'makeup' || r.status === 'transfer_in') simpleStatus = 'present';
        else if (r.status === 'transfer_out') simpleStatus = 'absent';

        return {
            groupTitle: group?.title ?? '未知檔期',
            courseName: course?.name ?? '',
            teacher: course?.teacher ?? '',
            date: session?.session_date ?? '',
            sessionNumber: session?.session_number ?? 0,
            status: simpleStatus,
            href: (gId && cId) ? `/courses/groups/${gId}/${cId}` : undefined,
        };
    }).filter((r: any) => r.date !== '');

    // ── 3. Makeup: available missed sessions ──
    const availableSessions = await getAvailableMakeupQuotaSessions(user.id);

    const makeupSessions = availableSessions.map((s: any) => {
        const gId = s.groupSlug || s.groupId;
        const cId = s.courseSlug || s.courseId;

        return {
            groupTitle: s.groupTitle,
            courseName: s.courseName,
            teacher: s.teacher,
            date: s.date,
            sessionNumber: s.number,
            status: 'available' as const,
            href: gId ? `/courses/groups/${gId}` : undefined,
        };
    });

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
                makeupSessions={makeupSessions}
            />
        </div>
    );
}
