'use server';

/**
 * Supabase query helpers — server-side only
 * Use these in Server Components and Server Actions
 */
import { createClient } from './server';
import type {
    CourseGroup,
    Course,
    CourseSession,
    CourseWithDetails,
    EnrollmentWithProfile,
    AttendanceWithProfile,
    LeaveRequestWithProfiles,
    Profile,
    CourseEnrollmentStatus,
    SystemConfig,
} from '@/types/database';

// ------------------------------------------------------------------
// Course Groups
// ------------------------------------------------------------------

export async function getCourseGroups() {
    const supabase = await createClient();
    const nowStr = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
        .from('course_groups')
        .select('*')
        .or(`period_end.is.null,period_end.gte.${nowStr}`)
        .order('period_end', { ascending: false });

    if (error) throw new Error(`getCourseGroups: ${error.message}`);
    return data as CourseGroup[];
}

export async function getCourseGroupById(groupId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('course_groups')
        .select('*')
        .eq('id', groupId)
        .maybeSingle();

    if (error) throw new Error(`getCourseGroupById: ${error.message}`);
    return data as CourseGroup | null;
}

// ------------------------------------------------------------------
// Courses
// ------------------------------------------------------------------

export async function getCoursesByGroupId(groupId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('courses')
        .select(`
      *,
      course_leaders ( user_id, profiles ( id, name ) ),
      enrollments ( count )
    `)
        .eq('group_id', groupId)
        .order('start_time');

    if (error) throw new Error(`getCoursesByGroupId: ${error.message}`);
    return data;
}

export async function getCourseById(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('courses')
        .select(`
      *,
      course_groups ( id, title, region ),
      course_sessions ( * ),
      course_leaders ( *, profiles ( id, name ) ),
      enrollments ( count )
    `)
        .eq('id', courseId)
        .maybeSingle();

    if (error) throw new Error(`getCourseById: ${error.message}`);
    return data as CourseWithDetails | null;
}

// ------------------------------------------------------------------
// Enrollments
// ------------------------------------------------------------------

/** Get roster (enrolled students) for a course */
export async function getCourseRoster(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('enrollments')
        .select(`
      *,
      profiles ( id, name, role )
    `)
        .eq('course_id', courseId)
        .eq('status', 'enrolled')
        .order('enrolled_at');

    if (error) throw new Error(`getCourseRoster: ${error.message}`);
    return data as EnrollmentWithProfile[];
}

/** Get waitlist for a course */
export async function getCourseWaitlist(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('enrollments')
        .select('*, profiles ( id, name, role )')
        .eq('course_id', courseId)
        .eq('status', 'waitlist')
        .order('waitlist_position');

    if (error) throw new Error(`getCourseWaitlist: ${error.message}`);
    return data as EnrollmentWithProfile[];
}

/** Get enrollment status of a specific user in a course */
export async function getUserEnrollmentStatus(
    courseId: string,
    userId: string
): Promise<CourseEnrollmentStatus> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('enrollments')
        .select('*')
        .eq('course_id', courseId)
        .eq('user_id', userId);

    if (error) throw new Error(`getUserEnrollmentStatus: ${error.message}`);

    if (!data || data.length === 0) return { isEnrolled: false, isWaitlisted: false };

    // Prefer 'enrolled' over 'waitlist', and 'full' over 'single' for the status summary
    const enrolled = data.find(e => e.status === 'enrolled');
    const waitlisted = data.find(e => e.status === 'waitlist');
    const primary = enrolled || waitlisted || data[0];

    return {
        isEnrolled: data.some(e => e.status === 'enrolled'),
        isWaitlisted: !data.some(e => e.status === 'enrolled') && data.some(e => e.status === 'waitlist'),
        waitlistPosition: primary.waitlist_position ?? undefined,
        enrollment: primary,
    };
}

/** Get all courses a user is enrolled in */
export async function getUserEnrollments(userId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('enrollments')
        .select(`
      *,
      courses (
        *,
        course_groups ( id, title ),
        course_leaders ( profiles ( id, name ) )
      )
    `)
        .eq('user_id', userId)
        .in('status', ['enrolled', 'waitlist'])
        .order('enrolled_at', { ascending: false });

    if (error) throw new Error(`getUserEnrollments: ${error.message}`);
    return data;
}

// ------------------------------------------------------------------
// Attendance
// ------------------------------------------------------------------

/** Get attendance records for a specific session */
export async function getSessionAttendance(sessionId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('attendance_records')
        .select('*, profiles ( id, name, role )')
        .eq('session_id', sessionId);

    if (error) throw new Error(`getSessionAttendance: ${error.message}`);
    return data as AttendanceWithProfile[];
}

/** Get all attendance for a course (all sessions) */
export async function getCourseAttendance(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('attendance_records')
        .select(`
      *,
      profiles ( id, name, role ),
      course_sessions!inner ( id, session_date, session_number, course_id )
    `)
        .eq('course_sessions.course_id', courseId);

    if (error) throw new Error(`getCourseAttendance: ${error.message}`);
    return data;
}

// ------------------------------------------------------------------
// Requests (Leave / Makeup / Transfer)
// ------------------------------------------------------------------

/** Get leave requests for a course (leader/admin view) */
export async function getCourseLeaveRequests(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('leave_requests')
        .select(`
      *,
      profiles!leave_requests_user_id_fkey ( id, name ),
      course_sessions ( session_date, session_number )
    `)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });

    if (error) throw new Error(`getCourseLeaveRequests: ${error.message}`);
    return data;
}

/** Get makeup requests for a course (leader/admin view) */
export async function getCourseMakeupRequests(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('makeup_requests')
        .select(`
      *,
      profiles!makeup_requests_user_id_fkey ( id, name ),
      original_session:course_sessions!makeup_requests_original_session_id_fkey ( session_date, session_number ),
      target_session:course_sessions!makeup_requests_target_session_id_fkey ( session_date, session_number )
    `)
        .or(`original_course_id.eq.${courseId},target_course_id.eq.${courseId}`)
        .order('created_at', { ascending: false });

    if (error) throw new Error(`getCourseMakeupRequests: ${error.message}`);
    return data;
}

/** Get transfer requests for a course (leader/admin view) */
export async function getCourseTransferRequests(courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('transfer_requests')
        .select(`
      *,
      from_profile:profiles!transfer_requests_from_user_id_fkey ( id, name ),
      to_profile:profiles!transfer_requests_to_user_id_fkey ( id, name ),
      course_sessions ( session_date, session_number )
    `)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });

    if (error) throw new Error(`getCourseTransferRequests: ${error.message}`);
    return data;
}

/** Get all pending requests for user's dashboard */
export async function getUserPendingRequests(userId: string) {
    const supabase = await createClient();
    const [leaveRes, makeupRes, transferRes] = await Promise.all([
        supabase.from('leave_requests').select('*').eq('user_id', userId).eq('status', 'pending'),
        supabase.from('makeup_requests').select('*').eq('user_id', userId).eq('status', 'pending'),
        supabase.from('transfer_requests').select('*').eq('from_user_id', userId).eq('status', 'pending'),
    ]);

    return {
        leave: leaveRes.data ?? [],
        makeup: makeupRes.data ?? [],
        transfer: transferRes.data ?? [],
    };
}

/** Compute used makeup quota for a user in a course (current + next period) */
export async function getUserMakeupQuotaUsed(userId: string, courseId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('makeup_requests')
        .select('quota_used')
        .eq('user_id', userId)
        .eq('original_course_id', courseId)
        .eq('status', 'approved');

    if (error) throw new Error(`getUserMakeupQuotaUsed: ${error.message}`);
    return (data ?? []).reduce((sum, r) => sum + Number(r.quota_used), 0);
}

/** Count approved transfers from user in a course */
export async function getUserTransferCount(userId: string, courseId: string) {
    const supabase = await createClient();
    const { count, error } = await supabase
        .from('transfer_requests')
        .select('*', { count: 'exact', head: true })
        .eq('from_user_id', userId)
        .eq('course_id', courseId)
        .eq('status', 'approved');

    if (error) throw new Error(`getUserTransferCount: ${error.message}`);
    return count ?? 0;
}

// ------------------------------------------------------------------
// Card System
// ------------------------------------------------------------------

/** Get card orders for a user */
export async function getUserCardOrders(userId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('card_orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw new Error(`getUserCardOrders: ${error.message}`);
    return data;
}

/** Get card transaction history for a user */
export async function getUserCardTransactions(userId: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('card_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw new Error(`getUserCardTransactions: ${error.message}`);
    return data;
}

/** Get all pending card orders (admin view) */
export async function getPendingCardOrders() {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('card_orders')
        .select('*, profiles ( id, name, role )')
        .in('status', ['pending', 'remitted'])
        .order('created_at');

    if (error) throw new Error(`getPendingCardOrders: ${error.message}`);
    return data;
}

// ------------------------------------------------------------------
// System Config
// ------------------------------------------------------------------

export async function getSystemConfig(): Promise<Record<string, string>> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('system_config')
        .select('key, value');

    if (error) throw new Error(`getSystemConfig: ${error.message}`);
    return Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
}

export async function getCardPriceForUser(profile: Pick<Profile, 'role' | 'member_valid_until'>): Promise<number> {
    const config = await getSystemConfig();
    const isMember = profile.role !== 'guest' &&
        (!profile.member_valid_until || new Date(profile.member_valid_until) >= new Date());
    return isMember
        ? parseInt(config['card_price_member'] ?? '270', 10)
        : parseInt(config['card_price_non_member'] ?? '370', 10);
}

/** Get sessions available for makeup quota (absent/leave and not used) */
export async function getAvailableMakeupQuotaSessions(userId: string) {
    const supabase = await createClient();

    // Start both queries in parallel
    const [
        { data: attendance, error: attError },
        { data: requested, error: reqError },
        { data: enrollments, error: enrError },
        { data: transferReqs, error: transError },
        { data: profile, error: profError }
    ] = await Promise.all([
        supabase
            .from('attendance_records')
            .select(`
                session_id,
                status,
                course_sessions!inner (
                    id,
                    session_date,
                    session_number,
                    courses (
                        id,
                        slug,
                        name,
                        teacher,
                        group_id,
                        type,
                        course_sessions (count),
                        course_groups (
                            id,
                            slug,
                            title
                        )
                    )
                )
            `)
            .eq('user_id', userId)
            .in('status', ['absent', 'leave']),

        supabase
            .from('makeup_requests')
            .select('original_session_id, original_course_id, quota_used')
            .eq('user_id', userId)
            .in('status', ['pending', 'approved']),

        supabase
            .from('enrollments')
            .select('course_id')
            .eq('user_id', userId)
            .eq('type', 'full')
            .in('status', ['enrolled', 'waitlist']),

        supabase
            .from('transfer_requests')
            .select('course_id')
            .eq('from_user_id', userId)
            .eq('status', 'approved'),
        
        supabase
            .from('profiles')
            .select('makeup_quota')
            .eq('id', userId)
            .single()
    ]);

    if (attError) throw new Error(`getAvailableMakeupQuotaSessions (att): ${attError.message}`);
    if (reqError) throw new Error(`getAvailableMakeupQuotaSessions (req): ${reqError.message}`);
    if (enrError) throw new Error(`getAvailableMakeupQuotaSessions (enr): ${enrError.message}`);
    if (profError) throw new Error(`getAvailableMakeupQuotaSessions (prof): ${profError.message}`);

    const manualQuota = profile?.makeup_quota || 0;

    const usedSessionIds = new Set((requested || []).map(r => r.original_session_id));
    const fullEnrollmentCourseIds = new Set((enrollments || []).map(e => e.course_id));

    const validAttendance = (attendance ?? []).filter(a => {
        const course = (a.course_sessions as any).courses;
        // Remove if already used
        if (usedSessionIds.has(a.session_id)) return false;
        // Only 'normal' and 'special' courses offer makeup quotas
        if (course.type !== 'normal' && course.type !== 'special') return false;
        // Only 'full' enrolled students get makeup quotas
        if (!fullEnrollmentCourseIds.has(course.id)) return false;
        
        return true;
    });

    if (validAttendance.length === 0) return [];

    // Construct lookup maps locally in memory from the initial Promise.all results
    const usedMakeupByCourse: Record<string, number> = {};
    (requested ?? []).forEach((mr: any) => { 
        if (mr.original_course_id) {
            usedMakeupByCourse[mr.original_course_id] = (usedMakeupByCourse[mr.original_course_id] ?? 0) + Number(mr.quota_used); 
        }
    });

    const usedTransferByCourse: Record<string, number> = {};
    ((transferReqs as any) ?? []).forEach((tr: any) => { 
        usedTransferByCourse[tr.course_id] = (usedTransferByCourse[tr.course_id] ?? 0) + 1; 
    });

    return validAttendance.map(a => {
        const cId = (a.course_sessions as any).courses.id;
        
        const sessionsCountArray = (a.course_sessions as any).courses.course_sessions;
        const totalSessions = Array.isArray(sessionsCountArray) && sessionsCountArray.length > 0 ? sessionsCountArray[0].count : 0;

        const totalQuota = Math.ceil(totalSessions / 4);
        const usedQuota = (usedMakeupByCourse[cId] ?? 0) + (usedTransferByCourse[cId] ?? 0);
        const isQuotaFull = usedQuota >= totalQuota;

        return {
            sessionId: (a.course_sessions as any).id,
            date: (a.course_sessions as any).session_date,
            number: (a.course_sessions as any).session_number,
            courseId: cId,
            courseSlug: (a.course_sessions as any).courses.slug,
            courseName: (a.course_sessions as any).courses.name,
            teacher: (a.course_sessions as any).courses.teacher,
            groupId: (a.course_sessions as any).courses.group_id,
            groupSlug: (a.course_sessions as any).courses.course_groups?.slug,
            groupTitle: (a.course_sessions as any).courses.course_groups?.title ?? '未知群組',
            status: a.status,
            isQuotaFull,
            usedQuota,
            totalQuota,
            manualQuota // Adding manual adjustment from profile
        };
    });
}
/**
 * Compute remaining makeup quota for a user across all 'full' enrolled
 * normal/special courses in a given group_id (UUID).
 * Returns: sum of (computeMakeupQuota(sessionsCount) - usedMakeup - usedTransfer)
 * capped at 0 from below.
 */
export async function getMakeupRemainingQuotaForGroup(userId: string, groupId: string): Promise<{ total: number, used: number, remaining: number }> {
    const supabase = await createClient();

    const [
        { data: enrollments },
        { data: makeupRequests },
        { data: transferRequests }
    ] = await Promise.all([
        // 1. Find all full-enrolled, normal/special courses for this user in this group, and their session counts
        supabase
            .from('enrollments')
            .select(`
                course_id, 
                courses!inner ( 
                    id, 
                    type, 
                    group_id,
                    course_sessions(count)
                )
            `)
            .eq('user_id', userId)
            .eq('type', 'full')
            .in('status', ['enrolled', 'waitlist'])
            .eq('courses.group_id', groupId)
            .in('courses.type', ['normal', 'special']),

        // 2. Get used makeup quota globally for the user
        supabase
            .from('makeup_requests')
            .select('original_course_id, quota_used')
            .eq('user_id', userId)
            .in('status', ['pending', 'approved']),

        // 3. Get used transfer quota globally for the user
        supabase
            .from('transfer_requests')
            .select('course_id')
            .eq('from_user_id', userId)
            .eq('status', 'approved')
    ]);

    if (!enrollments || enrollments.length === 0) return { total: 0, used: 0, remaining: 0 };

    const courseIds = new Set(enrollments.map((e: any) => e.course_id));

    const usedMakeupByCourse: Record<string, number> = {};
    (makeupRequests ?? []).forEach((mr: any) => {
        if (courseIds.has(mr.original_course_id)) {
            usedMakeupByCourse[mr.original_course_id] = (usedMakeupByCourse[mr.original_course_id] ?? 0) + Number(mr.quota_used);
        }
    });

    const usedTransferByCourse: Record<string, number> = {};
    ((transferRequests as any) ?? []).forEach((tr: any) => {
        if (courseIds.has(tr.course_id)) {
            usedTransferByCourse[tr.course_id] = (usedTransferByCourse[tr.course_id] ?? 0) + 1;
        }
    });

    let totalQuotaSum = 0;
    let totalUsedSum = 0;

    for (const enr of enrollments) {
        const course = (enr as any).courses;
        if (!course) continue;

        const cId = enr.course_id;
        const sessionsCountArray = course.course_sessions;
        const sessionsCount = Array.isArray(sessionsCountArray) && sessionsCountArray.length > 0 ? sessionsCountArray[0].count : 0;
        
        const totalQuota = Math.ceil(sessionsCount / 4);
        const usedMakeup = usedMakeupByCourse[cId] ?? 0;
        const usedTransfer = usedTransferByCourse[cId] ?? 0;
        
        totalQuotaSum += totalQuota;
        totalUsedSum += (usedMakeup + usedTransfer);
    }

    const totalRemaining = Math.max(0, totalQuotaSum - totalUsedSum);

    return {
        total: totalQuotaSum,
        used: totalUsedSum,
        remaining: totalRemaining
    };
}

/** Get attendance history for a specific user */
export async function getUserAttendanceHistory(userId: string, limit = 10) {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('attendance_records')
        .select(`
            status,
            course_sessions (
                id,
                session_date,
                session_number,
                courses (
                    id,
                    name,
                    teacher
                )
            )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new Error(`getUserAttendanceHistory: ${error.message}`);
    return data;
}
/** Get all user profiles (for selection) */
export async function getProfiles() {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name, role')
        .order('name');

    if (error) throw new Error(`getProfiles: ${error.message}`);
    return data as Profile[];
}
