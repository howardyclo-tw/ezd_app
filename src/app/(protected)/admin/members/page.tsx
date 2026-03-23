import { createClient, getServerProfile } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft, UserSquare } from "lucide-react";
import Link from 'next/link';
import { MembersClient } from '@/components/admin/members-client';
import { getAvailableMakeupQuotaSessions } from '@/lib/supabase/queries';

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
    const { user, profile: currentProfile } = await getServerProfile();
    if (!user) redirect('/login');
    if (currentProfile?.role !== 'admin') redirect('/dashboard');

    const supabase = await createClient();

    // Fetch in parallel
    const [
        { data: profiles },
        { data: leaderData },
        { data: enrollmentData },
        { data: courseSessionCounts },
        { data: makeupData },
        { data: transferData },
        { data: attendanceData },
    ] = await Promise.all([
        supabase
            .from('profiles')
            .select('id, name, employee_id, role, member_valid_until, card_balance, makeup_quota')
            .order('name', { ascending: true }),

        supabase
            .from('course_leaders')
            .select(`user_id, courses ( name, course_groups ( title ) )`)
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('enrollments')
            .select(`
                id,
                user_id,
                course_id,
                status,
                source,
                type,
                session_id,
                courses ( id, name, type, course_groups ( title ) ),
                course_sessions ( id, session_date )
            `)
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('course_sessions')
            .select('course_id')
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('makeup_requests')
            .select('user_id, original_course_id, status, quota_used')
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('transfer_requests')
            .select('from_user_id, course_id, status')
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('attendance_records')
            .select(`
                user_id,
                session_id,
                status,
                course_sessions (
                    id,
                    courses ( id, type )
                )
            `)
            .in('status', ['absent', 'leave'])
            .then(res => res.error ? { data: [] } : res),
    ]);

    // Sessions map
    const courseSessionCountMap = new Map<string, number>();
    for (const cs of courseSessionCounts ?? []) {
        courseSessionCountMap.set(cs.course_id, (courseSessionCountMap.get(cs.course_id) || 0) + 1);
    }

    // Leader map
    const leaderMap = new Map<string, any[]>();
    for (const ld of leaderData ?? []) {
        const course = ld.courses as any;
        if (!course) continue;
        const entry = { courseName: course.name, groupTitle: course.course_groups?.title || '' };
        leaderMap.set(ld.user_id, [...(leaderMap.get(ld.user_id) || []), entry]);
    }

    // Quota map logic
    const enrollmentMap = new Map<string, any[]>();
    const userQuotaCourses = new Map<string, { id: string; name: string; quota: number }[]>();

    for (const en of enrollmentData ?? []) {
        const course = en.courses as any;
        if (!course) continue;
        const courseId = (en as any).course_id as string;
        const enrollType = (en as any).type || 'full';

        // Display
        const enrolls = enrollmentMap.get(en.user_id) || [];
        const existing = enrolls.find(e => e.courseId === courseId);
        const date = (en.course_sessions as any)?.session_date || '未定日期';
        if (existing) {
            existing.sessions.push({ id: en.id, date, source: (en as any).source });
        } else {
            enrolls.push({
                courseId,
                courseName: course.name,
                groupTitle: course.course_groups?.title || '',
                sessions: [{ id: en.id, date, source: (en as any).source }]
            });
            enrollmentMap.set(en.user_id, enrolls);
        }

        // Calculation: Normal or Special courses with full enrollment
        if (enrollType === 'full' && (course.type === 'normal' || course.type === 'special')) {
            const currentQuotas = userQuotaCourses.get(en.user_id) || [];
            if (!currentQuotas.some(q => q.id === courseId)) {
                const sessions = courseSessionCountMap.get(courseId) || 0;
                if (sessions > 0) {
                    currentQuotas.push({ id: courseId, name: course.name, quota: Math.ceil(sessions / 4) });
                    userQuotaCourses.set(en.user_id, currentQuotas);
                }
            }
        }
    }

    const attendanceDataCast = (attendanceData as any[]) || [];

    // Pre-calculate global maps
    const quotaUsedMap = new Map<string, number>();
    const makeupCourseUsedMap = new Map<string, number>(); // userId-courseId -> sum(quota_used)
    (makeupData ?? []).forEach(m => { 
        if(m.status === 'approved' || m.status === 'pending') {
            const key = `${m.user_id}-${(m as any).original_course_id || (m as any).course_id}`;
            makeupCourseUsedMap.set(key, (makeupCourseUsedMap.get(key) || 0) + Number(m.quota_used));
            quotaUsedMap.set(m.user_id, (quotaUsedMap.get(m.user_id) || 0) + Number(m.quota_used));
        }
    });

    const transferCountMap = new Map<string, number>(); // userId-courseId -> count
    (transferData as any[] ?? []).forEach(t => { 
        if(t.status === 'approved') {
            const key = `${t.from_user_id}-${t.course_id}`;
            transferCountMap.set(key, (transferCountMap.get(key) || 0) + 1);
            quotaUsedMap.set(t.from_user_id, (quotaUsedMap.get(t.from_user_id) || 0) + 1);
        }
    });

    // Attendance index: user_id -> sessions
    const userAttendanceMap = new Map<string, any[]>();
    attendanceDataCast.forEach(a => {
        const list = userAttendanceMap.get(a.user_id) || [];
        list.push(a);
        userAttendanceMap.set(a.user_id, list);
    });

    // Map of user_id -> Set of course_id for full enrollments
    const userFullEnrollmentMap = new Map<string, Set<string>>();
    (enrollmentData ?? []).forEach(en => {
        if (en.type === 'full' && (en.status === 'enrolled' || en.status === 'waitlist')) {
            const set = userFullEnrollmentMap.get(en.user_id) || new Set();
            set.add(en.course_id);
            userFullEnrollmentMap.set(en.user_id, set);
        }
    });

    // Final calculation - NO MORE ASYNC MAP
    const members = (profiles ?? []).map(p => {
        const details = userQuotaCourses.get(p.id) || [];
        const base = details.reduce((a, b) => a + b.quota, 0);
        const used = quotaUsedMap.get(p.id) || 0;
        const adj = p.makeup_quota || 0;
        
        // In-memory version of getAvailableMakeupQuotaSessions logic
        const userAttendances = userAttendanceMap.get(p.id) || [];
        const fullCourseIds = userFullEnrollmentMap.get(p.id) || new Set();
        
        // Unified display: Count actual missed sessions (Spendable) PLUS manual adjustment
        const spendableAttendances: any[] = [];
        
        // We need to track uses per course to respect the O(1) capping
        const courseAbsences = new Map<string, any[]>();
        userAttendances.forEach(a => {
            const cId = (a.course_sessions as any)?.courses?.id;
            if (cId && fullCourseIds.has(cId)) {
                const list = courseAbsences.get(cId) || [];
                list.push(a);
                courseAbsences.set(cId, list);
            }
        });

        courseAbsences.forEach((absences, cId) => {
            // Re-calculate total quota for this course (same as getAvailableMakeupQuotaSessions)
            const sessionsCount = courseSessionCountMap.get(cId) || 0;
            const totalQuota = Math.ceil(sessionsCount / 4);
            
            // Re-calculate used for this specific course
            const userCourseKey = `${p.id}-${cId}`;
            const usedMakeup = makeupCourseUsedMap.get(userCourseKey) || 0;
            const usedTransfer = transferCountMap.get(userCourseKey) || 0;
            const usedSoFar = usedMakeup + usedTransfer;
            
            const allowed = Math.max(0, totalQuota - usedSoFar);
            const actuallySpendable = absences.slice(0, allowed);
            spendableAttendances.push(...actuallySpendable);
        });

        const spendableMissedCount = spendableAttendances.length;
        const finalSpendable = spendableMissedCount + adj;

        // Simplify details to only show which courses actually gave these spendable points
        const spendableDetails = Array.from(new Set(spendableAttendances.map(a => (a.course_sessions as any)?.courses?.name))).filter(Boolean);

        return {
            id: p.id,
            name: p.name || '(未設定姓名)',
            employee_id: p.employee_id,
            role: p.role,
            member_valid_until: p.member_valid_until,
            card_balance: p.card_balance ?? 0,
            makeup_quota: finalSpendable,
            makeup_base: base,
            makeup_used: used,
            makeup_adj: adj,
            makeup_base_details: spendableDetails, // Only show courses that actually provided the spendable points
            leader_courses: leaderMap.get(p.id) || [],
            enrollments: enrollmentMap.get(p.id) || [],
        };
    });

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground">
                        <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <UserSquare className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">社員管理</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">共 {members.length} 人</p>
                        </div>
                    </div>
                </div>
            </div>
            <MembersClient members={members} />
        </div>
    );
}
