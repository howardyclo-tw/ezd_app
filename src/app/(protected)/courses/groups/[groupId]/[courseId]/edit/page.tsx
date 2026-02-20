import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { CourseForm } from '@/components/admin/course-form';
import { parseISO } from 'date-fns';

export default async function EditCoursePage({ params }: { params: Promise<{ groupId: string, courseId: string }> }) {
    const { groupId, courseId } = await params;
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Fetch course data
    const isIdUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId);
    const { data: course, error } = await supabase
        .from('courses')
        .select(`
            *,
            course_groups ( id, slug ),
            course_sessions ( session_date ),
            course_leaders ( profiles!course_leaders_user_id_fkey ( name ) )
        `)
        .or(isIdUuid ? `id.eq.${courseId},slug.eq.${courseId}` : `slug.eq.${courseId}`)
        .maybeSingle();

    if (error || !course) {
        console.error('Fetch error:', error);
        notFound();
    }

    // Sort and format sessions
    const sessions = (course.course_sessions as any[])
        .sort((a: any, b: any) => a.session_date.localeCompare(b.session_date))
        .map((s: any) => ({ date: parseISO(s.session_date) }));

    const group = course.course_groups as any;
    const leaderName = (course.course_leaders as any[])?.[0]?.profiles?.name || 'none';

    const initialData = {
        groupId: group?.slug || group?.id || '',
        name: course.name,
        description: course.description || '',
        leader: leaderName,
        type: course.type as any,
        teacher: course.teacher,
        room: course.room,
        start_time: course.start_time?.slice(0, 5) || '19:00',
        end_time: course.end_time?.slice(0, 5) || '20:30',
        sessions_count: sessions.length,
        capacity: course.capacity,
        status: course.status as any,
        first_session_at: sessions[0]?.date,
        sessions: sessions,
    };

    return (
        <div className="mx-auto max-w-5xl px-4 py-8">
            <CourseForm initialData={initialData} mode="edit" />
        </div>
    );
}
