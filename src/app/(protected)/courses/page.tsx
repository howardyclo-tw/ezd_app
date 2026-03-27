import { createClient } from '@/lib/supabase/server';
import { CourseGroupCard } from "@/components/courses/course-group-card";
import { CourseGroupFilter } from "@/components/courses/course-group-filter";

export const dynamic = 'force-dynamic';

function getGroupStatus(periodStart: string | null, periodEnd: string | null): string {
    // Compare using date strings (YYYY-MM-DD) to avoid timezone issues
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    if (periodEnd && periodEnd < today) return 'ended';
    if (periodStart && periodStart > today) return 'upcoming';
    return 'active';
}

// Helper: compute course status for display
function getCourseDisplayStatus(course: any): string {
    const now = new Date();
    const enrollStart = course.enrollment_start_at ? new Date(course.enrollment_start_at) : null;
    const enrollEnd = course.enrollment_end_at ? new Date(course.enrollment_end_at) : null;

    if (enrollStart && enrollStart > now) return 'upcoming';
    if (enrollEnd && enrollEnd < now) return 'ended';

    const enrolledCount = (course.enrollments as any[])?.[0]?.count ?? 0;
    if (enrolledCount >= course.capacity) return 'full';
    return 'open';
}

export default async function CourseGroupsPage() {
    const supabase = await createClient();

    const { data: groups, error } = await supabase
        .from('course_groups')
        .select(`
            id,
            slug,
            title,
            period_start,
            period_end,
            courses (
                id,
                slug,
                name,
                teacher,
                start_time,
                end_time,
                room,
                type,
                capacity,
                enrollment_start_at,
                enrollment_end_at,
                course_sessions ( id, session_date, session_number ),
                enrollments ( count ),
                course_leaders ( user_id, profiles!course_leaders_user_id_fkey ( id, name ) )
            )
        `)
        .order('period_end', { ascending: false });

    const groupData = (groups ?? []).map(g => {
        const courses = (g.courses as any[]) ?? [];

        // Compute actual dates from all sessions in all courses
        const allSessionDates = courses
            .flatMap(c => (c.course_sessions as any[]) ?? [])
            .map(s => s.session_date)
            .filter(Boolean)
            .sort((a: string, b: string) => a.localeCompare(b));
        
        const minDate = allSessionDates.length > 0 ? allSessionDates[0] : g.period_start;
        const maxDate = allSessionDates.length > 0 ? allSessionDates[allSessionDates.length - 1] : g.period_end;

        const periodDisplay = minDate && maxDate
            ? `${minDate.replace(/-/g, '/')}~${maxDate.replace(/-/g, '/')}`
            : '日期未定';

        return {
            id: g.slug || g.id,
            title: g.title,
            period: periodDisplay,
            maxDate: maxDate, // Store for sorting
            status: getGroupStatus(minDate, maxDate),
            courseCount: courses.length,
            courses: courses.map(course => {
                const sessions = (course.course_sessions as any[]) ?? [];
                sessions.sort((a: any, b: any) => a.session_date.localeCompare(b.session_date));
                const firstSession = sessions[0];
                const lastSession = sessions[sessions.length - 1];

                return {
                    id: course.id,
                    name: course.name,
                    teacher: course.teacher,
                    time: `${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)}`,
                    location: course.room,
                    type: course.type,
                    status: getCourseDisplayStatus(course),
                    capacity: course.capacity,
                    startDate: firstSession?.session_date ?? '',
                    endDate: lastSession?.session_date ?? '',
                };
            }),
        };
    });

    // Sort by actual end date (latest first)
    groupData.sort((a, b) => {
        if (!a.maxDate) return 1;
        if (!b.maxDate) return -1;
        return b.maxDate.localeCompare(a.maxDate);
    });

    return (
        <div className="container max-w-4xl py-10 space-y-6">
            <div className="space-y-1.5 mb-10 text-center">
                <h1 className="text-2xl font-bold tracking-tight">課程檔期</h1>
                <p className="text-muted-foreground text-sm font-medium">瀏覽目前課程檔期，一起來跳舞吧!</p>
            </div>

            <CourseGroupFilter groups={groupData} />
        </div>
    );
}
