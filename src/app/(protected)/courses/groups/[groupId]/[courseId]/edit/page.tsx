import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { CourseForm } from '@/components/admin/course-form';
import { parseISO } from 'date-fns';
import { isAdmin } from '@/types/database';

export default async function EditCoursePage({ params }: { params: Promise<{ groupId: string, courseId: string }> }) {
    const { groupId, courseId } = await params;
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || !isAdmin(profile.role)) {
        redirect('/dashboard');
    }

    // Fetch course data
    const isIdUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId);
    const { data: course, error } = await supabase
        .from('courses')
        .select(`
            *,
            course_groups ( id, slug ),
            course_sessions ( 
                id, 
                session_date, 
                session_number, 
                attendance_records ( id ),
                leave_requests ( id ),
                makeup_requests_original:makeup_requests!makeup_requests_original_session_id_fkey ( id ),
                makeup_requests_target:makeup_requests!makeup_requests_target_session_id_fkey ( id ),
                transfer_requests ( id )
            ),
            course_leaders ( user_id, profiles!course_leaders_user_id_fkey ( name ) )
        `)
        .or(isIdUuid ? `id.eq.${courseId},slug.eq.${courseId}` : `slug.eq.${courseId}`)
        .maybeSingle();

    if (error || !course) {
        console.error('Fetch error:', error);
        notFound();
    }

    // Sort and format sessions
    const sessions = (course.course_sessions as any[])
        .sort((a: any, b: any) => a.session_number - b.session_number)
        .map((s: any) => {
            const hasAttendance = (s.attendance_records?.length || 0) > 0;
            const hasLeave = (s.leave_requests?.length || 0) > 0;
            const hasMakeup = (s.makeup_requests_original?.length || 0) > 0 || (s.makeup_requests_target?.length || 0) > 0;
            const hasTransfer = (s.transfer_requests?.length || 0) > 0;

            return {
                id: s.id,
                date: parseISO(s.session_date),
                hasData: hasAttendance || hasLeave || hasMakeup || hasTransfer
            };
        });

    const leaderId = (course.course_leaders as any[])?.[0]?.user_id || 'none';

    const initialData = {
        id: course.id,
        groupId: course.group_id,
        name: course.name,
        description: course.description || '',
        leader: leaderId,
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
