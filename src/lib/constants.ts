/**
 * Shared display constants for attendance and enrollment status badges.
 * Authoritative source: 點名單 (course-detail-client.tsx)
 */

export const ATTENDANCE_COLORS: Record<string, string> = {
    present: 'bg-green-500/10 text-green-600',
    absent: 'bg-red-500/10 text-red-500',
    leave: 'bg-blue-500/10 text-blue-600',
    makeup: 'bg-purple-500/10 text-purple-600',
    transfer_in: 'bg-purple-500/10 text-purple-600',
    transfer_out: 'bg-slate-500/10 text-slate-500',
    unmarked: '',
};

export const ATTENDANCE_LABELS: Record<string, string> = {
    present: '出席',
    absent: '缺席',
    leave: '請假',
    makeup: '補課',
    transfer_in: '轉入',
    transfer_out: '轉出',
    unmarked: '',
};

/** Enrollment source type badges */
export const ENROLL_TYPE_COLORS: Record<string, string> = {
    single: 'bg-orange-500/10 text-orange-500',
    makeup: 'bg-purple-500/10 text-purple-600',
    transfer_in: 'bg-purple-500/10 text-purple-600',
};

export const ENROLL_TYPE_LABELS: Record<string, string> = {
    full: '',
    single: '加報',
    makeup: '補課',
    transfer_in: '轉入',
};

/** Enrollment status badges (5R.3+) */
export const ENROLLMENT_STATUS_COLORS: Record<string, string> = {
    enrolled: 'bg-green-500/10 text-green-600',
    pending_payment: 'bg-amber-500/10 text-amber-600',
    pending_vote: 'bg-blue-500/10 text-blue-600',
    waitlist: 'bg-slate-500/10 text-slate-500',
    cancelled: 'bg-red-500/10 text-red-500',
};

export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
    enrolled: '已成立',
    pending_payment: '待繳費',
    pending_vote: '待開票',
    waitlist: '候補',
    cancelled: '已取消',
};
