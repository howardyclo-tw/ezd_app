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
    const { data, error } = await supabase
        .from('course_groups')
        .select('*')
        .order('period_start', { ascending: false });

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
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw new Error(`getUserEnrollmentStatus: ${error.message}`);

    if (!data) return { isEnrolled: false, isWaitlisted: false };

    return {
        isEnrolled: data.status === 'enrolled',
        isWaitlisted: data.status === 'waitlist',
        waitlistPosition: data.waitlist_position ?? undefined,
        enrollment: data,
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
