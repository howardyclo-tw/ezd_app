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
