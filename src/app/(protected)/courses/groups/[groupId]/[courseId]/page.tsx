import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { CourseDetailClient } from '@/components/courses/course-detail-client';
import { getAvailableMakeupQuotaSessions, getMakeupRemainingQuotaForGroup } from '@/lib/supabase/queries';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

export default async function CourseDetailPage({ params }: { params: Promise<{ groupId: string, courseId: string }> }) {
    const { groupId, courseId } = await params;
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // 1. Fetch profile and course in parallel
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

    const [
        { data: profile },
        { data: course, error: courseError }
    ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        courseQuery.maybeSingle()
    ]);

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
    const sessionIds = (course.course_sessions as any[]).map((s: any) => s.id);
    const [
        { count: enrolledCount },
        { data: enrollment },
        { data: userProfileWithCardBalance },
        missedSessionsResult,
        makeupQuota,
        { data: roster },
        { data: makeupsArriving },
        { data: transfersApproved },
        { data: leaveRequests },
        { data: attendanceRecords },
        { data: makeupsDeparting },
        { data: userMakeupTargets },
        { data: userTransferInTargets },
    ] = await Promise.all([
        // 2. Enrolled count
        supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', course.id)
            .eq('status', 'enrolled'),

        // 3. Current user enrollment status
        supabase
            .from('enrollments')
            .select('*')
            .eq('course_id', course.id)
            .eq('user_id', user.id),

        // 4. Current user card balance
        supabase
            .from('profiles')
            .select('card_balance')
            .eq('id', user.id)
            .maybeSingle(),

        // 5. Available makeup sessions
        getAvailableMakeupQuotaSessions(user.id),

        // 5b. Detailed makeup quota for this group
        getMakeupRemainingQuotaForGroup(user.id, course.group_id),

        // 6. Roster (enrolled + waitlisted)
        supabase
            .from('enrollments')
            .select('*, profiles ( id, name, role )')
            .eq('course_id', course.id)
            .in('status', ['enrolled', 'waitlist'])
            .order('enrolled_at'),

        // 7. Makeup students arriving in this course
        supabase
            .from('makeup_requests')
            .select('*, profiles:user_id ( id, name, role )')
            .eq('target_course_id', course.id)
            .eq('status', 'approved'),
        
        // 8. ALL approved transfer requests for this course (both Out and In)
        supabase
            .from('transfer_requests')
            .select('*, from_profile:profiles!transfer_requests_from_user_id_fkey(id, name, role), to_profile:profiles!transfer_requests_to_user_id_fkey(id, name, role)')
            .eq('course_id', course.id)
            .eq('status', 'approved'),

        // 9. Leave requests for this course
        supabase
            .from('leave_requests')
            .select('*')
            .eq('course_id', course.id)
            .eq('status', 'approved'),

        // 10. Attendance records
        supabase
            .from('attendance_records')
            .select('*')
            .in('session_id', sessionIds),

        // 11. Makeups departing from this course (to calculate used quota)
        // Exclude quota-only (幹部贈予) where original_session_id is null — those don't consume per-course 1/4 cap
        supabase
            .from('makeup_requests')
            .select('quota_used, original_session_id')
            .eq('original_course_id', course.id)
            .eq('user_id', user.id)
            .not('original_session_id', 'is', null)
            .in('status', ['pending', 'approved']),

        // 12. Current user's existing makeup/transfer_in targets in this course (for UI exclusion)
        supabase
            .from('makeup_requests')
            .select('target_session_id')
            .eq('target_course_id', course.id)
            .eq('user_id', user.id)
            .in('status', ['pending', 'approved']),

        supabase
            .from('transfer_requests')
            .select('session_id')
            .eq('course_id', course.id)
            .eq('to_user_id', user.id)
            .eq('status', 'approved'),
    ]);

    const missedSessions = (missedSessionsResult as any)?.sessions ?? [];

    // Sessions the current user already occupies via makeup or transfer_in
    const userOccupiedSessionIds = [
        ...(userMakeupTargets ?? []).map((m: any) => m.target_session_id),
        ...(userTransferInTargets ?? []).map((t: any) => t.session_id),
    ];

    // Build attendance map: { [userId]: { [sessionId]: status } }
    const attendanceMap: Record<string, Record<string, string>> = {};
    (attendanceRecords ?? []).forEach(record => {
        if (!attendanceMap[record.user_id]) attendanceMap[record.user_id] = {};
        attendanceMap[record.user_id][record.session_id] = record.status;
    });

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
    
    // Only count transfers that actually Arrive in this course (have a to_user_id)
    (transfersApproved ?? []).forEach(t => {
        if (!t.to_profile || !t.to_user_id) return;
        const p = t.to_profile as any;
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
                enrolledSessionIds: hasFull 
                    ? sortedSessions.map((s: any) => s.id)
                    : userEnrollments.filter(e => e.status === 'enrolled').map(e => e.session_id).filter(Boolean),
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

    // Reuse transfersApproved for detailed labels (names)
    const transferMetadata: Record<string, Record<string, { type: 'transfer_out' | 'transfer_in'; fromName: string; toName: string }>> = {};
    (transfersApproved ?? []).forEach(t => {
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

    // Build makeup metadata: { [sessionId]: { [userId]: true } }
    const makeupSessionMap: Record<string, Set<string>> = {};
    (makeupsArriving ?? []).forEach(m => {
        if (!m.profiles) return;
        const p = m.profiles as any;
        if (!makeupSessionMap[m.target_session_id]) makeupSessionMap[m.target_session_id] = new Set();
        makeupSessionMap[m.target_session_id].add(p.id);
    });

    // --- Calculate Session Occupancy ---
    // Formula: n = (Official/Single Enrollments) + (Approved Makeup) + (Arriving Transfers) - (Approved Leave) - (Outgoing Transfers)
    // Note: Arriving Transfers and Outgoing Transfers here are matching pairs on the SAME session.
    // If a full-term student transfers out to a non-student, BaseCount includes sender, Arriving +1, Outgoing -1 => net 0 change to seats. 
    // If we want total occupied seats, we just need to ensure each unique occupied seat is counted once.
    
    // We can use the roster itself to count, as it consolidates all participants.
    const sessionOccupancy: Record<string, number> = {};
    sortedSessions.forEach((s: any) => {
        let count = 0;
        rosterWithAttendance.forEach(student => {
            const origType = getOriginalTypeForOccupancy(student, s.id, transferMetadata);
            // Count if: 
            // - Student is Official (full) and NOT on leave/transfer_out
            // - Student is Additional (single/makeup/transfer_in) and assigned to this session
            if (origType === 'normal' || origType === 'single' || origType === 'makeup' || origType === 'transfer_in') {
                count++;
            }
        });
        sessionOccupancy[s.id] = count;
    });

    // --- Calculate specific quota for THIS course ---
    const isFullEnrolled = (enrollment as any[] || []).some(e => e.status === 'enrolled' && e.type === 'full');
    let courseQuota = { total: 0, used: 0, remaining: 0 };
    if (isFullEnrolled && (course.type === 'normal' || course.type === 'special')) {
        const total = Math.ceil(sortedSessions.length / 4);
        const usedMakeup = (makeupsDeparting ?? []).reduce((sum, m) => sum + Number(m.quota_used), 0);
        const usedTransfer = (transfersApproved ?? []).filter(t => t.from_user_id === user.id).length;
        const used = usedMakeup + usedTransfer;
        courseQuota = { total, used, remaining: Math.max(0, total - used) };
    }

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
            makeupSessionMap={Object.fromEntries(Object.entries(makeupSessionMap).map(([k, v]) => [k, Array.from(v)]))}
            enrolledCount={enrolledCount ?? 0}
            userEnrollment={{
                userId: user.id,
                enrollmentStatus: {
                    // isEnrolled is true if in enrollment table OR happens to have any attendance record (makeup/transfer)
                    isEnrolled: (enrollment as any[] || []).some(e => e.status === 'enrolled') || !!attendanceMap[user.id],
                    isFullEnrolled: (enrollment as any[] || []).some(e => e.status === 'enrolled' && e.type === 'full'),
                    isWaitlisted: (enrollment as any[] || []).some(e => e.status === 'waitlist'),
                    waitlistPosition: (enrollment as any[] || []).find(e => e.status === 'waitlist')?.waitlist_position ?? undefined,
                    enrolledSessionIds: (rosterWithAttendance.find(r => r.id === user.id)?.enrolledSessionIds ?? []),
                }
            }}
            cardBalance={userProfileWithCardBalance?.card_balance ?? 0}
            missedSessions={missedSessions}
            makeupQuota={makeupQuota}
            courseQuota={courseQuota}
            canManageAttendance={canManageAttendance}
            currentUserRole={profile?.role ?? 'guest'}
            sessionOccupancy={sessionOccupancy}
            userOccupiedSessionIds={userOccupiedSessionIds}
        />
    );
}

// Helper duplicated from client or moved to common lib if needed
function getOriginalTypeForOccupancy(student: any, sessionId: string, transferMetadata: any): string {
    const meta = transferMetadata[sessionId]?.[student.id];
    const dbStatus = student.attendance[sessionId] ?? 'unmarked';
    const isOfficial = student.type === 'official';

    if (meta) return meta.type;
    if (dbStatus === 'transfer_out') return 'transfer_out';
    if (dbStatus === 'transfer_in') return 'transfer_in';
    if (dbStatus === 'leave') return 'leave';

    if (dbStatus === 'makeup') return 'makeup';
    if (!isOfficial && student.enrolledSessionIds?.includes(sessionId)) return 'single';
    if (!isOfficial) return 'none';
    return 'normal';
}
