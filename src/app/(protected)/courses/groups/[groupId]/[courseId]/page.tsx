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
            course_sessions ( id, session_date, session_number ),
            course_leaders ( id, user_id, profiles!course_leaders_user_id_fkey ( id, name, role ) )
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

    // Fetch all independent data in parallel using the resolved course.id
    const [
        { count: enrolledCount },
        { data: enrollment },
        { data: userProfileWithCardBalance },
        missedSessions,
        { data: roster },
        { data: makeupsArriving },
        { data: transfersArriving },
    ] = await Promise.all([
        // 1. Enrolled count
        supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', course.id)
            .eq('status', 'enrolled'),

        // 2. Current user enrollment status (may have multiple for single-sessions)
        supabase
            .from('enrollments')
            .select('*')
            .eq('course_id', course.id)
            .eq('user_id', user.id),

        // 3. Current user card balance
        supabase
            .from('profiles')
            .select('card_balance')
            .eq('id', user.id)
            .maybeSingle(),

        // 4. Available makeup sessions
        getAvailableMakeupQuotaSessions(user.id),

        // 5. Roster (enrolled + waitlisted)
        supabase
            .from('enrollments')
            .select('*, profiles ( id, name, role )')
            .eq('course_id', course.id)
            .in('status', ['enrolled', 'waitlist'])
            .order('enrolled_at'),

        // 6. Makeup students arriving in this course
        supabase
            .from('makeup_requests')
            .select('*, profiles:user_id ( id, name, role )')
            .eq('target_course_id', course.id)
            .eq('status', 'approved'),
        
        // 7. Transfer students arriving in this course
        supabase
            .from('transfer_requests')
            .select('*, profiles:to_user_id ( id, name, role )')
            .eq('course_id', course.id)
            .eq('status', 'approved')
            .not('to_user_id', 'is', null),
    ]);

    // Attendance records — depends on course.course_sessions being resolved
    const sessionIds = (course.course_sessions as any[]).map((s: any) => s.id);
    let attendanceRecords: any[] = [];
    if (sessionIds.length > 0) {
        const { data: attendance } = await supabase
            .from('attendance_records')
            .select('*')
            .in('session_id', sessionIds);
        attendanceRecords = attendance ?? [];
    }

    // Build attendance map: { [userId]: { [sessionId]: status } }
    const attendanceMap: Record<string, Record<string, string>> = {};
    for (const record of attendanceRecords) {
        if (!attendanceMap[record.user_id]) attendanceMap[record.user_id] = {};
        attendanceMap[record.user_id][record.session_id] = record.status;
    }

    // Track which sessions and users are involved from Makeup/Transfer
    const externalParticipantsMap: Record<string, { profile: any; sessions: string[] }> = {};
    (makeupsArriving ?? []).forEach(m => {
        if (!m.profiles) return;
        const p = m.profiles as any;
        if (!externalParticipantsMap[p.id]) {
            externalParticipantsMap[p.id] = { profile: p, sessions: [] };
        }
        externalParticipantsMap[p.id].sessions.push(m.target_session_id);
    });
    (transfersArriving ?? []).forEach(t => {
        if (!t.profiles) return;
        const p = t.profiles as any;
        if (!externalParticipantsMap[p.id]) {
            externalParticipantsMap[p.id] = { profile: p, sessions: [] };
        }
        externalParticipantsMap[p.id].sessions.push(t.session_id);
    });

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

    // Group enrollments by user to handle multiple single-session enrollments
    const enrollmentsByUser: Record<string, any[]> = {};
    (roster ?? []).forEach(e => {
        if (!e.profiles) return;
        if (!enrollmentsByUser[e.user_id]) enrollmentsByUser[e.user_id] = [];
        enrollmentsByUser[e.user_id].push(e);
    });

    const enrolledUserIds = new Set<string>();
    const enrollmentRoster: any[] = [];

    Object.entries(enrollmentsByUser).forEach(([userId, userEnrollments]) => {
        const hasFullEnrolled = userEnrollments.some(e => e.status === 'enrolled' && e.type === 'full');
        const hasSingleEnrolled = userEnrollments.some(e => e.status === 'enrolled' && e.type === 'single');
        const isEnrolled = hasFullEnrolled || hasSingleEnrolled;

        if (isEnrolled) {
            enrolledUserIds.add(userId);
            const p = userEnrollments[0].profiles;
            const hasFull = hasFullEnrolled;
            enrollmentRoster.push({
                id: p.id,
                name: p.name,
                role: p.role,
                isLeader: (course.course_leaders as any[]).some((cl: any) => cl.user_id === p.id),
                type: hasFull ? 'official' : 'additional',
                attendance: attendanceMap[p.id] ?? {},
                enrolledSessionIds: userEnrollments.filter(e => e.status === 'enrolled').map(e => e.session_id).filter(Boolean),
            });
        }
    });

    // 2. Find ANYONE ELSE who has an attendance record or makeup/transfer intent
    const otherParticipantUserIds = Array.from(new Set([
        ...Object.keys(attendanceMap),
        ...Object.keys(externalParticipantsMap)
    ])).filter(id => !enrolledUserIds.has(id));

    let additionalOnlyRoster: any[] = [];
    if (otherParticipantUserIds.length > 0) {
        const { data: additionalProfiles } = await supabase
            .from('profiles')
            .select('id, name, role')
            .in('id', otherParticipantUserIds);

        additionalOnlyRoster = (additionalProfiles ?? []).map(p => {
            const externalSessions = externalParticipantsMap[p.id]?.sessions || [];
            // CRITICAL: Also include ALL sessions where this user has attendance records
            // This prevents students from disappearing when their status is set to 'unmarked'
            const attendanceSessions = Object.keys(attendanceMap[p.id] ?? {});
            const allSessions = Array.from(new Set([...externalSessions, ...attendanceSessions]));
            return {
                id: p.id,
                name: p.name,
                role: p.role,
                isLeader: (course.course_leaders as any[]).some((cl: any) => cl.user_id === p.id),
                type: 'additional',
                attendance: attendanceMap[p.id] ?? {},
                enrolledSessionIds: allSessions,
            };
        });
    }

    // Combined Roster
    const rosterWithAttendance = [...enrollmentRoster, ...additionalOnlyRoster];

    // Fetch transfer metadata for detailed labels (names)
    const { data: transfers } = await supabase
        .from('transfer_requests')
        .select('session_id, from_user_id, to_user_id, from_profile:profiles!transfer_requests_from_user_id_fkey(name), to_profile:profiles!transfer_requests_to_user_id_fkey(name)')
        .eq('course_id', course.id)
        .eq('status', 'approved');

    const transferMetadata: Record<string, Record<string, { type: 'transfer_out' | 'transfer_in'; fromName: string; toName: string }>> = {};
    (transfers ?? []).forEach(t => {
        if (!transferMetadata[t.session_id]) transferMetadata[t.session_id] = {};
        const fromName = (t.from_profile as any)?.name ?? '未知';
        const toName = (t.to_profile as any)?.name ?? (t as any).to_user_name ?? '外部人士';

        // Map for sender
        transferMetadata[t.session_id][t.from_user_id] = { type: 'transfer_out', fromName, toName };
        // Map for receiver
        if (t.to_user_id) {
            transferMetadata[t.session_id][t.to_user_id] = { type: 'transfer_in', fromName, toName };
        }
    });

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
                leader: leaders.join(', ') || '',
                groupTitle: (course.course_groups as any)?.title ?? '',
                groupId: (course.course_groups as any)?.slug ?? (course.course_groups as any)?.id ?? '',
                groupUuid: course.group_id,
            }}
            sessions={sortedSessions.map((s: any, i: number) => ({
                id: s.id,
                date: s.session_date,
                number: i + 1,
            }))}
            roster={rosterWithAttendance}
            transferMetadata={transferMetadata}
            enrolledCount={enrolledCount ?? 0}
            userEnrollment={{
                userId: user.id,
                enrollmentStatus: {
                    // isEnrolled is true if in enrollment table OR happens to have any attendance record (makeup/transfer)
                    isEnrolled: (enrollment as any[] || []).some(e => e.status === 'enrolled') || !!attendanceMap[user.id],
                    isFullEnrolled: (enrollment as any[] || []).some(e => e.status === 'enrolled' && e.type === 'full'),
                    isWaitlisted: (enrollment as any[] || []).some(e => e.status === 'waitlist'),
                    waitlistPosition: (enrollment as any[] || []).find(e => e.status === 'waitlist')?.waitlist_position ?? undefined,
                    enrolledSessionIds: (enrollment as any[] || []).filter(e => e.status === 'enrolled').map(e => e.session_id).filter(Boolean),
                }
            }}
            cardBalance={userProfileWithCardBalance?.card_balance ?? 0}
            missedSessions={missedSessions}
            canManageAttendance={canManageAttendance}
            currentUserRole={profile?.role ?? 'guest'}
        />
    );
}
