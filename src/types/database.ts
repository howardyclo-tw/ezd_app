/**
 * EZD App - Database TypeScript Types
 * Matches the Supabase schema defined in supabase/migrations/001_course_schema.sql
 */

// ------------------------------------------------------------------
// Enums / Literal Types
// ------------------------------------------------------------------

export type UserRole = 'guest' | 'member' | 'leader' | 'admin';

export type CourseType =
  | 'normal'       // 一般常態
  | 'trial'        // 試跳課程
  | 'special'      // 特殊常態
  | 'style'        // 風格體驗
  | 'workshop'     // 專攻班
  | 'rehearsal'    // 團練
  | 'performance'; // 表演班

export type CourseStatus = 'draft' | 'published' | 'closed';

export type EnrollmentStatus = 'enrolled' | 'waitlist' | 'cancelled';
export type EnrollmentSource = 'self' | 'admin' | 'card_purchase';

export type AttendanceStatus =
  | 'unmarked'
  | 'present'
  | 'absent'
  | 'leave'
  | 'makeup'
  | 'transfer_in'
  | 'transfer_out';

export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type TransferStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type CardTransactionType = 'purchase' | 'deduct' | 'refund' | 'expire' | 'admin_adjust';
export type CardOrderStatus = 'pending' | 'remitted' | 'confirmed' | 'cancelled';

// ------------------------------------------------------------------
// Core Entities
// ------------------------------------------------------------------

export interface Profile {
  id: string;
  name: string;
  employee_id?: string | null;
  role: UserRole;
  member_valid_until?: string | null; // ISO date string "YYYY-MM-DD"
  card_balance: number; // current card balance (denormalized for performance)
  created_at: string;
  updated_at: string;
}

export interface CourseGroup {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  region: string; // "HQ" | "竹北" | etc.
  period_start: string | null; // "YYYY-MM-DD"
  period_end: string | null;   // "YYYY-MM-DD"
  registration_phase1_start: string | null; // ISO string
  registration_phase1_end: string | null;   // ISO string
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  group_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  type: CourseType;
  teacher: string;
  room: string;
  start_time: string; // "HH:MM"
  end_time: string;   // "HH:MM"
  capacity: number;
  cards_per_session: number;
  status: 'draft' | 'published' | 'closed';
  enrollment_start_at: string | null;
  enrollment_end_at: string | null;
  wiki_url: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseSession {
  id: string;
  course_id: string;
  session_date: string; // "YYYY-MM-DD"
  session_number: number;
  is_cancelled: boolean;
  cancel_note?: string | null;
  created_at: string;
}

export interface CourseLeader {
  id: string;
  course_id: string;
  user_id: string;
  assigned_by?: string | null;
  assigned_at: string;
}

// ------------------------------------------------------------------
// Enrollment & Attendance
// ------------------------------------------------------------------

export type EnrollmentType = 'full' | 'single';

export interface Enrollment {
  id: string;
  course_id: string;
  user_id: string;
  status: EnrollmentStatus;
  type: EnrollmentType;
  session_id?: string | null;
  waitlist_position?: number | null;
  source: EnrollmentSource;
  enrolled_at: string;
  cancelled_at?: string | null;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  user_id: string;
  status: AttendanceStatus;
  note?: string | null;
  marked_by?: string | null;
  marked_at?: string | null;
  created_at: string;
}

// ------------------------------------------------------------------
// Requests
// ------------------------------------------------------------------

export interface LeaveRequest {
  id: string;
  course_id: string;
  session_id: string;
  user_id: string;
  reason?: string | null;
  status: RequestStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
}

export interface MakeupRequest {
  id: string;
  original_course_id: string;
  original_session_id: string;
  target_course_id: string;
  target_session_id: string;
  user_id: string;
  status: RequestStatus;
  quota_used: number; // e.g. 0.5 for cross-zone conversion
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
}

export interface TransferRequest {
  id: string;
  course_id: string;
  session_id: string;
  from_user_id: string;
  to_user_id?: string | null;
  to_user_name?: string | null;
  extra_cards_required: number;
  status: TransferStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
}

// ------------------------------------------------------------------
// Card System
// ------------------------------------------------------------------

export interface CardOrder {
  id: string;
  user_id: string;
  quantity: number;
  unit_price: number; // NTD per card
  total_amount: number;
  status: CardOrderStatus;
  remittance_account_last5?: string | null;
  remittance_date?: string | null;
  remittance_note?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  expires_at?: string | null; // "YYYY-MM-DD"
  created_at: string;
  updated_at: string;
}

export interface CardTransaction {
  id: string;
  user_id: string;
  type: CardTransactionType;
  amount: number; // positive = add, negative = deduct
  balance_after: number;
  order_id?: string | null;
  enrollment_id?: string | null;
  note?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface SystemConfig {
  key: string;
  value: string;
  description?: string | null;
  updated_by?: string | null;
  updated_at: string;
}

// ------------------------------------------------------------------
// Joined / View Types (for UI usage)
// ------------------------------------------------------------------

/** Course with its group and sessions, returned on course detail page */
export interface CourseWithDetails extends Course {
  course_groups: Pick<CourseGroup, 'id' | 'title' | 'region'>;
  course_sessions: CourseSession[];
  course_leaders: (CourseLeader & { profiles: Pick<Profile, 'id' | 'name'> })[];
  enrollments: { count: number }[]; // aggregated count
}

/** Enrollment enriched with user profile, returned in roster */
export interface EnrollmentWithProfile extends Enrollment {
  profiles: Pick<Profile, 'id' | 'name' | 'role'>;
}

/** Attendance record with profile, for attendance table */
export interface AttendanceWithProfile extends AttendanceRecord {
  profiles: Pick<Profile, 'id' | 'name' | 'role'>;
}

/** Leave request with user and reviewer info */
export interface LeaveRequestWithProfiles extends LeaveRequest {
  user: Pick<Profile, 'id' | 'name'>;
  reviewer?: Pick<Profile, 'id' | 'name'> | null;
  course_sessions: Pick<CourseSession, 'session_date' | 'session_number'>;
}

/** For computing enrollment status of the current user */
export interface CourseEnrollmentStatus {
  isEnrolled: boolean;
  isWaitlisted: boolean;
  waitlistPosition?: number;
  enrollment?: Enrollment;
}

// ------------------------------------------------------------------
// Helper Functions
// ------------------------------------------------------------------

export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    guest: 0,
    member: 1,
    leader: 2,
    admin: 3,
  };
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

export function isLeader(role: UserRole): boolean {
  return role === 'leader' || role === 'admin';
}

export function isMember(role: UserRole): boolean {
  return role === 'member' || role === 'leader' || role === 'admin';
}

/** Compute makeup quota: ceil(sessions_count * 1/4) */
export function computeMakeupQuota(sessionsCount: number): number {
  return Math.ceil(sessionsCount / 4);
}

/** Check if enrollment/transfer window is open for today (上課前) */
export function isBeforeClass(sessionDate: string, startTime: string): boolean {
  const now = new Date();
  const classStart = new Date(`${sessionDate}T${startTime}`);
  return now < classStart;
}

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  normal: '一般常態',
  trial: '試跳課程',
  special: '特殊常態',
  style: '風格體驗',
  workshop: '專攻班',
  rehearsal: '團練',
  performance: '表演班',
};
