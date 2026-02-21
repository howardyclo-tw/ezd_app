import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { CourseDetailClient } from '@/components/courses/course-detail-client';
import { getAvailableMakeupQuotaSessions } from '@/lib/supabase/queries';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

export default async function CourseDetailPage({ params }: { params: Promise<{ groupId: string, courseId: string }> }) {
    const { groupId, courseId } = await params;
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Get current user profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    // Fetch course with all related data (supporting ID or slug)
    const isIdUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId);
    const courseQuery = supabase.from('courses').select(`
            *,
            course_groups ( id, title, region, slug ),
            course_sessions ( id, session_date, session_number, is_cancelled, cancel_note ),
            course_leaders ( id, user_id, profiles!course_leaders_user_id_fkey ( id, name ) )
        `);

    if (isIdUuid) {
        courseQuery.or(`id.eq.${courseId},slug.eq.${courseId}`);
    } else {
        courseQuery.eq('slug', courseId);
    }

    const { data: course, error: courseError } = await courseQuery.maybeSingle();

    if (courseError || !course) notFound();

    // Auto-fix URL: Always redirect to the hierarchical slug-based URL
    const gShortId = (course.course_groups as any)?.slug || (course.course_groups as any)?.id;
    const cShortId = course.slug || course.id;

    // If current path isn't the canonical one, redirect
    if (courseId !== cShortId || groupId !== gShortId) {
        redirect(`/courses/groups/${gShortId}/${cShortId}`);
    }

    // Double check if it belongs to the group if groupId is provided as UUID
    const isGroupUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId);
    if (isGroupUuid && course.group_id !== groupId) {
        // Only enforce if it's a UUID. If it's a slug, we trust the relationship fetched from DB.
        // Actually, better to just check the slug of the group as well if we want total strictness.
    }

    // Fetch enrolled count
    const { count: enrolledCount } = await supabase
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', course.id)
        .eq('status', 'enrolled');

    // Fetch user status and profile (for card balance)
    const { data: enrollment } = await supabase
        .from('enrollments')
        .select('*')
        .eq('course_id', course.id)
        .eq('user_id', user.id)
        .maybeSingle();

    const { data: userProfileWithCardBalance } = await supabase
        .from('profiles')
        .select('card_balance')
        .eq('id', user.id)
        .maybeSingle();

    // Fetch missed sessions available for makeup
    const missedSessions = await getAvailableMakeupQuotaSessions(user.id);

    // Fetch roster (enrolled students)
    const { data: roster } = await supabase
        .from('enrollments')
        .select('*, profiles ( id, name, role )')
        .eq('course_id', course.id)
        .eq('status', 'enrolled')
        .order('enrolled_at');

    // Fetch all attendance records for this course's sessions
    const sessionIds = (course.course_sessions as any[]).map((s: any) => s.id);
    let attendanceRecords: any[] = [];
    if (sessionIds.length > 0) {
        const { data: attendance } = await supabase
            .from('attendance_records')
            .select('*')
            .in('session_id', sessionIds);
        attendanceRecords = attendance ?? [];
    }

    // Check if current user is a leader of this course
    const isLeaderOfCourse = (course.course_leaders as any[]).some(
        (cl: any) => cl.user_id === user.id
    );
    const isAdmin = profile?.role === 'admin';
    const canManageAttendance = isLeaderOfCourse || isAdmin;

    // Sort sessions by date
    const sortedSessions = (course.course_sessions as any[]).sort(
        (a: any, b: any) => a.session_date.localeCompare(b.session_date)
    );

    // Build leader display
    const leaders = (course.course_leaders as any[]).map(
        (cl: any) => cl.profiles?.name ?? '未知'
    );

    // Build attendance map: { [userId]: { [sessionId]: status } }
    const attendanceMap: Record<string, Record<string, string>> = {};
    for (const record of attendanceRecords) {
        if (!attendanceMap[record.user_id]) {
            attendanceMap[record.user_id] = {};
        }
        attendanceMap[record.user_id][record.session_id] = record.status;
    }

    // Build student list with attendance (filter out null profiles for safety)
    const rosterWithAttendance = (roster ?? [])
        .filter((enrollment: any) => enrollment.profiles)
        .map((enrollment: any) => ({
            id: enrollment.profiles.id,
            name: enrollment.profiles.name,
            role: enrollment.profiles.role,
            isLeader: (course.course_leaders as any[]).some(
                (cl: any) => cl.user_id === enrollment.profiles.id
            ),
            type: 'official' as const, // Defaulting to official for now
            attendance: attendanceMap[enrollment.profiles.id] ?? {},
        }));

    return (
        <CourseDetailClient
            course={{
                id: course.id,
                name: course.name,
                description: course.description ?? '',
                type: course.type,
                teacher: course.teacher,
                room: course.room,
                startTime: course.start_time?.slice(0, 5) ?? '',
                endTime: course.end_time?.slice(0, 5) ?? '',
                capacity: course.capacity,
                cardsPerSession: course.cards_per_session,
                status: course.status,
                leader: leaders.join(', ') || '',
                groupTitle: (course.course_groups as any)?.title ?? '',
                groupId: (course.course_groups as any)?.slug ?? (course.course_groups as any)?.id ?? '',
                groupUuid: course.group_id,
            }}
            sessions={sortedSessions.map((s: any) => ({
                id: s.id,
                date: s.session_date,
                number: s.session_number,
                isCancelled: s.is_cancelled,
            }))}
            roster={rosterWithAttendance}
            enrolledCount={enrolledCount ?? 0}
            userEnrollment={{
                userId: user.id,
                enrollmentStatus: {
                    isEnrolled: enrollment?.status === 'enrolled',
                    isWaitlisted: enrollment?.status === 'waitlist',
                    waitlistPosition: enrollment?.waitlist_position ?? undefined,
                }
            }}
            cardBalance={userProfileWithCardBalance?.card_balance ?? 0}
            missedSessions={missedSessions}
            canManageAttendance={canManageAttendance}
            currentUserRole={profile?.role ?? 'guest'}
        />
    );
}
