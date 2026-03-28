import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft, UserSquare } from "lucide-react";
import Link from 'next/link';
import { MembersClient } from '@/components/admin/members-client';

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
    const supabase = await createClient();

    // Fetch auth + all data in a single parallel batch
    const [
        { data: { user } },
        { data: profiles },
        { data: leaderData },
        { data: enrollmentData },
        { data: allCourseSessions },
        { data: makeupData },
        { data: transferData },
        { data: allAttendanceData },
        { data: allCourses },
        { data: cardOrdersData },
        { data: memberGroups },
    ] = await Promise.all([
        supabase.auth.getUser(),
        supabase
            .from('profiles')
            .select('id, name, employee_id, role, member_group_id, card_balance, makeup_quota')
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
                courses ( id, name, type, teacher, course_groups ( title ) ),
                course_sessions ( id, session_date )
            `)
            .then(res => res.error ? { data: [] } : res),

        // All course sessions (used for: session counts, full enrollment display, date lookups)
        supabase
            .from('course_sessions')
            .select('id, course_id, session_date')
            .order('session_date')
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('makeup_requests')
            .select('user_id, original_course_id, original_session_id, target_session_id, target_course_id, status, quota_used')
            .then(res => res.error ? { data: [] } : res),

        supabase
            .from('transfer_requests')
            .select('from_user_id, to_user_id, course_id, session_id, status')
            .then(res => res.error ? { data: [] } : res),

        // All attendance records (used for: quota calc + display)
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
            .then(res => res.error ? { data: [] } : res),

        // All courses (for makeup/transfer display)
        supabase
            .from('courses')
            .select('id, name, teacher, course_groups ( title )')
            .then(res => res.error ? { data: [] } : res),

        // Card orders (for card pools display)
        supabase
            .from('card_orders')
            .select('id, user_id, quantity, used, expires_at')
            .eq('status', 'confirmed')
            .order('expires_at', { ascending: true })
            .then(res => res.error ? { data: [] } : res),

        // Member groups
        supabase
            .from('member_groups')
            .select('id, name, valid_until')
            .order('valid_until', { ascending: false })
            .then(res => res.error ? { data: [] } : res),
    ]);

    // Filter attendance for quota calculation (only absent/leave)
    const attendanceData = (allAttendanceData ?? []).filter((a: any) => a.status === 'absent' || a.status === 'leave');

    if (!user) redirect('/login');

    // Fetch auth user emails (admin only, after auth check)
    const emailMap = new Map<string, string>();
    try {
        const adminClient = createAdminClient();
        const { data: authUsers } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
        (authUsers?.users ?? []).forEach(u => { if (u.email) emailMap.set(u.id, u.email); });
    } catch (e) {
        console.error('Failed to fetch auth users for emails:', e);
    }

    // Admin check: find current user's profile from the already-fetched list
    const currentProfile = profiles?.find(p => p.id === user.id);
    if (currentProfile?.role !== 'admin') redirect('/dashboard');

    // Sessions map (derived from allCourseSessions)
    const courseSessionCountMap = new Map<string, number>();
    for (const cs of allCourseSessions ?? []) {
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

    // Build course -> all sessions lookup for full enrollments (from already-fetched data)
    const allCourseSessionsMap = new Map<string, { id: string; date: string }[]>();
    (allCourseSessions ?? []).forEach(cs => {
        const list = allCourseSessionsMap.get(cs.course_id) || [];
        list.push({ id: cs.id, date: cs.session_date });
        allCourseSessionsMap.set(cs.course_id, list);
    });

    // Build per-user per-session attendance status map from ALL records (for display)
    const attendanceStatusMap = new Map<string, string>();
    (allAttendanceData as any[] ?? []).forEach(a => {
        attendanceStatusMap.set(`${a.user_id}-${a.session_id}`, a.status);
    });

    // Build makeup target sessions: "userId-sessionId" -> true
    const makeupTargetMap = new Set<string>();
    (makeupData ?? []).forEach(m => {
        if ((m.status === 'approved' || m.status === 'pending') && (m as any).target_session_id) {
            makeupTargetMap.add(`${m.user_id}-${(m as any).target_session_id}`);
        }
    });

    // Build transfer_in sessions: "userId-sessionId" -> true
    const transferInMap = new Set<string>();
    (transferData as any[] ?? []).forEach(t => {
        if (t.status === 'approved' && t.to_user_id && t.session_id) {
            transferInMap.add(`${t.to_user_id}-${t.session_id}`);
        }
    });

    for (const en of enrollmentData ?? []) {
        const course = en.courses as any;
        if (!course) continue;
        const courseId = (en as any).course_id as string;
        const enrollType = (en as any).type || 'full';

        // Display
        const enrolls = enrollmentMap.get(en.user_id) || [];
        const existing = enrolls.find(e => e.courseId === courseId);

        const buildSessionInfo = (sessionId: string, date: string, source: string) => {
            const key = `${en.user_id}-${sessionId}`;
            const attendance = attendanceStatusMap.get(key) || 'unmarked';
            // Determine the true type of this session
            let sessionType: string = enrollType; // 'full' or 'single'
            if (makeupTargetMap.has(key)) sessionType = 'makeup';
            else if (transferInMap.has(key)) sessionType = 'transfer_in';
            return { id: sessionId, date, source, attendance, sessionType };
        };

        if (enrollType === 'full' && !existing) {
            const courseSessions = allCourseSessionsMap.get(courseId) || [];
            enrolls.push({
                courseId,
                courseName: course.name,
                teacher: course.teacher || '',
                groupTitle: course.course_groups?.title || '',
                enrollType: 'full',
                sessions: courseSessions.map(cs => buildSessionInfo(cs.id, cs.date, (en as any).source))
            });
            enrollmentMap.set(en.user_id, enrolls);
        } else if (enrollType === 'single') {
            const sessionId = (en as any).session_id;
            const date = (en.course_sessions as any)?.session_date || '未定日期';
            const sessionInfo = buildSessionInfo(sessionId || en.id, date, (en as any).source);
            if (existing) {
                existing.sessions.push(sessionInfo);
            } else {
                enrolls.push({
                    courseId,
                    courseName: course.name,
                    teacher: course.teacher || '',
                    groupTitle: course.course_groups?.title || '',
                    enrollType: 'single',
                    sessions: [sessionInfo]
                });
                enrollmentMap.set(en.user_id, enrolls);
            }
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

    // Add makeup target sessions and transfer_in sessions to enrollment map
    // Build course info lookup (from already-fetched data)
    const courseInfoMap = new Map<string, { name: string; teacher: string; groupTitle: string }>();
    (allCourses ?? []).forEach(c => {
        courseInfoMap.set(c.id, { name: c.name, teacher: c.teacher, groupTitle: (c.course_groups as any)?.title || '' });
    });

    // Session -> course_id lookup
    const sessionCourseMap = new Map<string, string>();
    (allCourseSessions ?? []).forEach(cs => {
        sessionCourseMap.set(cs.id, cs.course_id);
    });

    // Add approved makeup targets
    (makeupData ?? []).forEach(m => {
        if (m.status !== 'approved' || !(m as any).target_session_id) return;
        const targetSessionId = (m as any).target_session_id as string;
        const targetCourseId = (m as any).target_course_id as string;
        const courseInfo = courseInfoMap.get(targetCourseId);
        if (!courseInfo) return;

        const sessionDate = (allCourseSessions ?? []).find(cs => cs.id === targetSessionId)?.session_date;
        if (!sessionDate) return;

        const enrolls = enrollmentMap.get(m.user_id) || [];
        const existing = enrolls.find(e => e.courseId === targetCourseId);
        const key = `${m.user_id}-${targetSessionId}`;
        const attendance = attendanceStatusMap.get(key) || 'unmarked';
        const sessionInfo = { id: targetSessionId, date: sessionDate, source: 'makeup', attendance, sessionType: 'makeup' };

        if (existing) {
            if (!existing.sessions.some((s: any) => s.id === targetSessionId)) {
                existing.sessions.push(sessionInfo);
            }
        } else {
            enrolls.push({
                courseId: targetCourseId,
                courseName: courseInfo.name,
                teacher: courseInfo.teacher,
                groupTitle: courseInfo.groupTitle,
                enrollType: 'makeup',
                sessions: [sessionInfo]
            });
            enrollmentMap.set(m.user_id, enrolls);
        }
    });

    // Add approved transfer_in
    (transferData as any[] ?? []).forEach(t => {
        if (t.status !== 'approved' || !t.to_user_id || !t.session_id) return;
        const courseInfo = courseInfoMap.get(t.course_id);
        if (!courseInfo) return;

        const sessionDate = (allCourseSessions ?? []).find((cs: any) => cs.id === t.session_id)?.session_date;
        if (!sessionDate) return;

        const enrolls = enrollmentMap.get(t.to_user_id) || [];
        const existing = enrolls.find((e: any) => e.courseId === t.course_id);
        const key = `${t.to_user_id}-${t.session_id}`;
        const attendance = attendanceStatusMap.get(key) || 'unmarked';
        const sessionInfo = { id: t.session_id, date: sessionDate, source: 'transfer', attendance, sessionType: 'transfer_in' };

        if (existing) {
            if (!existing.sessions.some((s: any) => s.id === t.session_id)) {
                existing.sessions.push(sessionInfo);
            }
        } else {
            enrolls.push({
                courseId: t.course_id,
                courseName: courseInfo.name,
                teacher: courseInfo.teacher,
                groupTitle: courseInfo.groupTitle,
                enrollType: 'transfer_in',
                sessions: [sessionInfo]
            });
            enrollmentMap.set(t.to_user_id, enrolls);
        }
    });

    // Sort sessions by date within each enrollment
    enrollmentMap.forEach(enrolls => {
        enrolls.forEach(en => {
            en.sessions.sort((a: any, b: any) => a.date.localeCompare(b.date));
        });
    });

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

    // Track which absence sessions have already been consumed by makeup requests
    const usedAbsenceSessionIds = new Set<string>();
    (makeupData ?? []).forEach(m => {
        if ((m.status === 'approved' || m.status === 'pending') && (m as any).original_session_id) {
            usedAbsenceSessionIds.add((m as any).original_session_id);
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
            // Filter out absences already consumed by makeup requests
            if (cId && fullCourseIds.has(cId) && !usedAbsenceSessionIds.has(a.session_id)) {
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
            email: emailMap.get(p.id) || null,
            employee_id: p.employee_id,
            role: p.role,
            member_group_id: p.member_group_id || null,
            card_balance: p.card_balance ?? 0,
            card_pools: (cardOrdersData ?? [])
                .filter(o => o.user_id === p.id)
                .map(o => ({ id: o.id, quantity: o.quantity, used: o.used, remaining: o.quantity - o.used, expires_at: o.expires_at })),
            makeup_quota: finalSpendable,
            makeup_base: base,
            makeup_used: used,
            makeup_adj: adj,
            makeup_base_details: spendableDetails, // Only show courses that actually provided the spendable points
            leader_courses: leaderMap.get(p.id) || [],
            enrollments: enrollmentMap.get(p.id) || [],
        };
    }).sort((a, b) => {
        const idA = a.employee_id || '';
        const idB = b.employee_id || '';
        // Users without employee_id go to the bottom
        if (idA === '' && idB !== '') return 1;
        if (idA !== '' && idB === '') return -1;
        if (idA === '' && idB === '') return a.name.localeCompare(b.name);
        // Numeric sort for employee IDs (e.g., "2" comes before "10")
        return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
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
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">成員管理</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">共 {members.length} 人</p>
                        </div>
                    </div>
                </div>
            </div>
            <MembersClient members={members} memberGroups={(memberGroups ?? []).map(g => ({ id: g.id, name: g.name, validUntil: g.valid_until }))} />
        </div>
    );
}
