import { createClient } from '@/lib/supabase/server';
import { CourseGroupCard } from "@/components/courses/course-group-card";
import { CourseGroupFilter } from "@/components/courses/course-group-filter";

export const dynamic = 'force-dynamic';

function getGroupStatus(periodStart: string | null, periodEnd: string | null): string {
    const now = new Date();
    const start = periodStart ? new Date(periodStart) : null;
    const end = periodEnd ? new Date(periodEnd) : null;

    if (end && end < now) return 'ended';
    if (start && start > now) return 'upcoming';
    return 'active';
}

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
                status,
                capacity,
                enrollment_start_at,
                enrollment_end_at,
                course_sessions ( id, session_date, session_number ),
                enrollments ( count ),
                course_leaders ( user_id, profiles!course_leaders_user_id_fkey ( id, name ) )
            )
        `)
        .order('period_start', { ascending: false });

    const groupData = (groups ?? []).map(g => {
        const courses = (g.courses as any[]) ?? [];
        const firstCourse = courses[0];

        return {
            id: g.slug || g.id,
            title: g.title,
            period: g.period_start && g.period_end
                ? `${g.period_start.replace(/-/g, '/')}~${g.period_end.replace(/-/g, '/')}`
                : '日期未定',
            status: getGroupStatus(g.period_start, g.period_end),
            courseCount: courses.length,
            courses: courses.map(course => ({
                id: course.id,
                name: course.name,
                teacher: course.teacher,
                time: `${course.start_time?.slice(0, 5)}~${course.end_time?.slice(0, 5)}`,
                location: course.room,
                type: course.type,
                status: getCourseDisplayStatus(course),
                capacity: course.capacity,
                startDate: course.course_sessions?.[0]?.session_date ?? '',
                endDate: course.course_sessions?.[course.course_sessions?.length - 1]?.session_date ?? '',
            })),
        };
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
