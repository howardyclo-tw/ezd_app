'use server';

/**
 * Server Actions — all mutations go through here
 * These run on the server, so they can use service-role or just createClient()
 */

import { revalidatePath } from 'next/cache';
import { createClient } from './server';
import { createAdminClient } from './admin';
import { computeMakeupQuota, isBeforeClass } from '@/types/database';
import { getUserMakeupQuotaUsed, getUserTransferCount, getSystemConfig } from './queries';


// ------------------------------------------------------------------
// Helper
// ------------------------------------------------------------------

async function getCurrentUser() {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Not authenticated');
    return { supabase, user };
}

// ------------------------------------------------------------------
// Enrollment Actions
// ------------------------------------------------------------------

/**
 * Enroll the current user in a course.
 * If the course is full, adds to waitlist automatically.
 * Now supports card deduction and enrollment types.
 */
export async function enrollInCourse(
    courseId: string,
    type: 'full' | 'single' = 'full',
    sessionId?: string
): Promise<{ success: boolean; status: 'enrolled' | 'waitlist'; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // 1. Check if already enrolled
    // For single-session, we check if already enrolled in THAT specific session
    // For full-term, we check if already enrolled in the course
    const checkQuery = supabase.from('enrollments')
        .select('id, status, type, session_id')
        .eq('course_id', courseId)
        .eq('user_id', user.id);

    if (type === 'single' && sessionId) {
        checkQuery.eq('session_id', sessionId);
    } else {
        checkQuery.eq('type', 'full');
    }

    const { data: existing } = await checkQuery.maybeSingle();

    if (existing && existing.status !== 'cancelled') {
        const typeLabel = existing.type === 'full' ? '整期' : '單堂';
        return { success: false, status: existing.status as any, message: `您已${typeLabel}報名此課程` };
    }

    // 2. Get course info and profile balance
    const [courseRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*, course_sessions(count)').eq('id', courseId).maybeSingle(),
        supabase.from('profiles').select('card_balance, role').eq('id', user.id).maybeSingle(),
    ]);

    const course = courseRes.data;
    const profile = profileRes.data;

    if (!course) throw new Error('課程不存在');
    if (!profile) throw new Error('使用者資料不存在');

    const now = new Date();
    if (course.enrollment_start_at && new Date(course.enrollment_start_at) > now) {
        throw new Error('報名尚未開始');
    }
    if (course.enrollment_end_at && new Date(course.enrollment_end_at) < now) {
        throw new Error('報名已截止');
    }

    // 3. Calculate cards to deduct and determine course end date for expiry check
    let cardsToDeduct = 0;
    const sessionsCount = (course.course_sessions as any)?.[0]?.count ?? 0;

    if (type === 'full') {
        cardsToDeduct = course.cards_per_session * sessionsCount;
    } else {
        cardsToDeduct = course.cards_per_session;
    }

    // Determine the end date for card expiry validation
    let courseEndDate: string;
    if (type === 'full') {
        // Full enrollment: use last session date
        const { data: lastSession } = await supabase
            .from('course_sessions')
            .select('session_date')
            .eq('course_id', courseId)
            .order('session_date', { ascending: false })
            .limit(1)
            .maybeSingle();
        courseEndDate = lastSession?.session_date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    } else {
        // Single enrollment: use that session's date
        const { data: sessionData } = await supabase
            .from('course_sessions')
            .select('session_date')
            .eq('id', sessionId!)
            .maybeSingle();
        courseEndDate = sessionData?.session_date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    }

    // Check available balance (unexpired as of course end date)
    const { getAvailableCardBalance } = await import('./card-utils');
    const cardInfo = await getAvailableCardBalance(user.id, courseEndDate);
    if (cardInfo.available < cardsToDeduct) {
        return {
            success: false,
            status: 'enrolled',
            message: `堂卡餘額不足（可用: ${cardInfo.available}, 需扣除: ${cardsToDeduct}）`,
        };
    }

    // 4. Check current enrollment count (for waitlist)
    // Waitlist is generally only for full-term or if capacity reached
    const { count: enrolledCount } = await supabase
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', courseId)
        .eq('status', 'enrolled');
    const isFull = (enrolledCount ?? 0) >= course.capacity;

    if (isFull) {
        // Add to waitlist
        const { count: waitlistCount } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', courseId)
            .eq('status', 'waitlist');

        const waitlist_position = (waitlistCount ?? 0) + 1;

        const { error } = await supabase.from('enrollments').upsert({
            id: existing?.id ?? undefined,
            course_id: courseId,
            user_id: user.id,
            status: 'waitlist',
            type,
            session_id: sessionId ?? null,
            waitlist_position,
            source: 'self',
            enrolled_at: new Date().toISOString(),
            cancelled_at: null,
        }, { onConflict: 'course_id,user_id,session_id' });

        if (error) throw new Error(`加入候補失敗: ${error.message}`);

        revalidatePath('/', 'layout');
        return { success: true, status: 'waitlist', message: '已加入候補名單 (候補期間不扣卡)' };
    }

    // 5. Enroll directly and deduct cards (FIFO)
    const { data: enrollment, error: enrollError } = await supabase.from('enrollments').upsert({
        id: existing?.id ?? undefined,
        course_id: courseId,
        user_id: user.id,
        status: 'enrolled',
        type,
        session_id: sessionId ?? null,
        source: 'self',
        enrolled_at: new Date().toISOString(),
        cancelled_at: null,
    }, { onConflict: 'course_id,user_id,session_id' }).select('id').single();

    if (enrollError) throw new Error(`報名失敗: ${enrollError.message}`);

    // FIFO deduct cards
    const { deductCardsFIFO } = await import('./card-utils');
    const { newBalance } = await deductCardsFIFO(
        user.id,
        cardsToDeduct,
        courseEndDate,
        `${type === 'full' ? '整期' : '單堂'}報名課程: ${course.name}`,
        enrollment.id
    );

    revalidatePath(`/`, `layout`);
    return { success: true, status: 'enrolled', message: `報名成功！扣除 ${cardsToDeduct} 堂卡，剩餘 ${newBalance} 堂。` };
}

/**
 * Batch enroll in multiple courses (Full-term only).
 * This is more efficient for the "Enroll Group" flow.
 */
export async function batchEnrollInCourses(
    courseIds: string[]
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    if (courseIds.length === 0) return { success: true, message: '無可報名課程' };

    // 1. Get courses and sessions count
    const [coursesRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*, course_sessions(count)').in('id', courseIds),
        supabase.from('profiles').select('card_balance').eq('id', user.id).maybeSingle(),
    ]);

    const courses = coursesRes.data ?? [];
    const profile = profileRes.data;

    if (!profile) throw new Error('使用者資料不存在');

    // 2. Check each course status and already enrolled
    // For MVP/simplicity, we'll filter out already enrolled ones
    const { data: existing } = await supabase.from('enrollments')
        .select('course_id')
        .eq('user_id', user.id)
        .eq('type', 'full')
        .eq('status', 'enrolled');

    const now = new Date();
    const enrolledIds = new Set((existing ?? []).map(e => e.course_id));
    const toEnroll = courses.filter(c => {
        if (enrolledIds.has(c.id)) return false;
        
        const enrollStart = c.enrollment_start_at ? new Date(c.enrollment_start_at) : null;
        const enrollEnd = c.enrollment_end_at ? new Date(c.enrollment_end_at) : null;
        
        if (enrollStart && enrollStart > now) return false;
        if (enrollEnd && enrollEnd < now) return false;
        
        return true;
    });

    if (toEnroll.length === 0) return { success: false, message: '所選課程皆已報名或不開放報名' };

    // 3. Calculate total cost and determine latest course end date
    let totalCost = 0;
    let latestEndDate = '';
    for (const course of toEnroll) {
        const sessionsCount = (course.course_sessions as any)?.[0]?.count ?? 0;
        totalCost += course.cards_per_session * sessionsCount;
    }

    // Get the latest session date across all courses being enrolled
    const allCourseIds = toEnroll.map(c => c.id);
    const { data: lastSessions } = await supabase
        .from('course_sessions')
        .select('session_date')
        .in('course_id', allCourseIds)
        .order('session_date', { ascending: false })
        .limit(1);
    latestEndDate = lastSessions?.[0]?.session_date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    // Check available balance
    const { getAvailableCardBalance } = await import('./card-utils');
    const cardInfo = await getAvailableCardBalance(user.id, latestEndDate);
    if (cardInfo.available < totalCost) {
        return { success: false, message: `堂卡餘額不足（可用: ${cardInfo.available}, 需扣除: ${totalCost}）` };
    }

    // 4. Create enrollments
    const enrollments = toEnroll.map(c => ({
        course_id: c.id,
        user_id: user.id,
        status: 'enrolled',
        type: 'full' as const,
        session_id: null,
        source: 'self' as const,
    }));

    const { data: inserted, error: enrollError } = await supabase.from('enrollments').upsert(enrollments, { onConflict: 'course_id,user_id,session_id' }).select('id, course_id');
    if (enrollError) throw new Error(`報名失敗: ${enrollError.message}`);

    // FIFO deduct cards
    const { deductCardsFIFO } = await import('./card-utils');
    const { newBalance } = await deductCardsFIFO(
        user.id,
        totalCost,
        latestEndDate,
        `整期報名 ${toEnroll.length} 門課程`,
        inserted?.[0]?.id
    );

    revalidatePath('/', 'layout');
    return { success: true, message: `成功報名 ${toEnroll.length} 門課程，扣除 ${totalCost} 堂卡。` };
}

/**
 * Batch enroll in multiple sessions of a single course.
 */
export async function batchEnrollInSessions(
    courseId: string,
    sessionIds: string[]
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    if (sessionIds.length === 0) return { success: true, message: '無可報名堂次' };

    // 1. Get course and profile
    const [courseRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*').eq('id', courseId).maybeSingle(),
        supabase.from('profiles').select('card_balance').eq('id', user.id).maybeSingle(),
    ]);

    const course = courseRes.data;
    const profile = profileRes.data;

    if (!course) throw new Error('課程不存在');
    if (!profile) throw new Error('使用者資料不存在');

    // 2. Check already enrolled sessions
    const { data: existing } = await supabase.from('enrollments')
        .select('session_id')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .eq('type', 'single')
        .eq('status', 'enrolled');

    const enrolledSessionIds = new Set((existing ?? []).map(e => e.session_id));
    const toEnrollSessionIds = sessionIds.filter(id => !enrolledSessionIds.has(id));

    if (toEnrollSessionIds.length === 0) return { success: false, message: '所選堂次皆已報名' };

    // 3. Get each session's date for per-session FIFO deduction
    const totalCost = course.cards_per_session * toEnrollSessionIds.length;

    const { data: sessionDateRows } = await supabase
        .from('course_sessions')
        .select('id, session_date')
        .in('id', toEnrollSessionIds)
        .order('session_date', { ascending: true });

    const sessionDateMap = new Map<string, string>();
    (sessionDateRows ?? []).forEach(s => sessionDateMap.set(s.id, s.session_date));

    // Quick check: use the latest session date for total available balance check
    const latestSessionDate = sessionDateRows?.[sessionDateRows.length - 1]?.session_date
        || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    const { getAvailableCardBalance } = await import('./card-utils');
    const cardInfo = await getAvailableCardBalance(user.id, latestSessionDate);
    if (cardInfo.available < totalCost) {
        return { success: false, message: `堂卡餘額不足（可用: ${cardInfo.available}, 需扣除: ${totalCost}）` };
    }

    // 4. Capacity guard: check each session's real-time occupancy
    // We need to fetch all factors affecting occupancy for these specific sessions
    const [baseEnrollRes, makeupRes, leaveRes, transferRes] = await Promise.all([
        supabase.from('enrollments').select('type, session_id').eq('course_id', courseId).eq('status', 'enrolled').or(`type.eq.full,session_id.in.(${toEnrollSessionIds.join(',')})`),
        supabase.from('makeup_requests').select('target_session_id').eq('target_course_id', courseId).eq('status', 'approved').in('target_session_id', toEnrollSessionIds),
        supabase.from('leave_requests').select('session_id').eq('course_id', courseId).eq('status', 'approved').in('session_id', toEnrollSessionIds),
        supabase.from('transfer_requests').select('session_id, from_user_id, to_user_id').eq('course_id', courseId).eq('status', 'approved').in('session_id', toEnrollSessionIds),
    ]);

    const baseEnrollments = baseEnrollRes.data || [];
    const makeups = makeupRes.data || [];
    const leaves = leaveRes.data || [];
    const transfers = transferRes.data || [];

    for (const sid of toEnrollSessionIds) {
        // formula: n = (Official/Single) + (Makeup) + (Transfer In) - (Leave) - (Transfer Out)
        const fullEnrolledCount = baseEnrollments.filter(e => e.type === 'full').length;
        const singleEnrolledCount = baseEnrollments.filter(e => e.type === 'single' && e.session_id === sid).length;
        const makeupCount = makeups.filter(m => m.target_session_id === sid).length;
        const leaveCount = leaves.filter(l => l.session_id === sid).length;
        const transferInCount = transfers.filter(t => t.session_id === sid && !!t.to_user_id).length;
        const transferOutCount = transfers.filter(t => t.session_id === sid).length;

        const occupancy = fullEnrolledCount + singleEnrolledCount + makeupCount + transferInCount - leaveCount - transferOutCount;
        if (occupancy >= course.capacity) {
            throw new Error(`第 ${toEnrollSessionIds.indexOf(sid) + 1} 個選擇的堂次已額滿，請重新整理頁面。`);
        }
    }

    // 5. Create enrollments
    const enrollments = toEnrollSessionIds.map(sid => ({
        course_id: courseId,
        user_id: user.id,
        status: 'enrolled' as const,
        type: 'single' as const,
        session_id: sid,
        source: 'self' as const,
        enrolled_at: new Date().toISOString(),
    }));

    const { data: inserted, error: enrollError } = await supabase.from('enrollments').upsert(enrollments, { onConflict: 'course_id,user_id,session_id' }).select('id, session_id');
    if (enrollError) throw new Error(`報名失敗: ${enrollError.message}`);

    // FIFO deduct cards per session (each session uses its own date for expiry check)
    const { deductCardsFIFO } = await import('./card-utils');
    for (const sid of toEnrollSessionIds) {
        const sessionDate = sessionDateMap.get(sid) || latestSessionDate;
        const enrollmentId = inserted?.find((i: any) => i.session_id === sid)?.id;
        await deductCardsFIFO(
            user.id,
            course.cards_per_session,
            sessionDate,
            `單堂報名課程: ${course.name} (${sessionDate})`,
            enrollmentId
        );
    }

    revalidatePath('/', 'layout');
    return { success: true, message: `成功報名 ${toEnrollSessionIds.length} 堂課，扣除 ${totalCost} 堂卡。` };
}

/**
 * Cancel current user's enrollment in a course.
 * Promotes first waitlist person if applicable.
 */
export async function cancelEnrollment(courseId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, status')
        .eq('course_id', courseId)
        .eq('user_id', user.id);

    const enrollment = enrollments?.find(e => e.status !== 'cancelled') || enrollments?.[0];

    if (!enrollment) return { success: false, message: '您未報名此課程' };

    // Cancel
    const { error } = await supabase
        .from('enrollments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', enrollment.id);

    if (error) throw new Error(`取消失敗: ${error.message}`);

    // Promote first waitlisted person if this was an enrolled slot
    if (enrollment.status === 'enrolled') {
        const { data: firstWaitlist } = await supabase
            .from('enrollments')
            .select('id')
            .eq('course_id', courseId)
            .eq('status', 'waitlist')
            .order('waitlist_position')
            .limit(1)
            .maybeSingle();

        if (firstWaitlist) {
            await supabase
                .from('enrollments')
                .update({ status: 'enrolled', waitlist_position: null })
                .eq('id', firstWaitlist.id);
        }
    }

    revalidatePath(`/`, `layout`);
    return { success: true, message: '已取消報名' };
}

// ------------------------------------------------------------------
// Leader Assignment
// ------------------------------------------------------------------

export async function assignCourseLeader(courseId: string, targetUserId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Verify current user is admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.role !== 'admin') throw new Error('只有幹部可以指派班長');

    // Enforce one-leader-per-course: check if there's already a different leader assigned
    const { data: existingLeaders } = await supabase
        .from('course_leaders')
        .select('user_id, profiles!course_leaders_user_id_fkey ( name )')
        .eq('course_id', courseId)
        .neq('user_id', targetUserId);

    if (existingLeaders && existingLeaders.length > 0) {
        const existingName = (existingLeaders[0] as any).profiles?.name ?? '現有班長';
        throw new Error(`每堂課只能有一位班長。請先移除「${existingName}」的班長身份後再指派。`);
    }

    // Upsert to handle re-assignment (same user)
    const { error } = await supabase
        .from('course_leaders')
        .upsert({ course_id: courseId, user_id: targetUserId, assigned_by: user.id }, { onConflict: 'course_id,user_id' });

    if (error) throw new Error(`指派失敗: ${error.message}`);

    revalidatePath(`/`, `layout`);
    return { success: true, message: '班長指派成功' };
}

export async function removeCourseLeader(courseId: string, targetUserId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.role !== 'admin') throw new Error('只有幹部可以移除班長');

    const { error } = await supabase
        .from('course_leaders')
        .delete()
        .eq('course_id', courseId)
        .eq('user_id', targetUserId);

    if (error) throw new Error(`移除失敗: ${error.message}`);

    revalidatePath(`/`, `layout`);
    return { success: true, message: '已移除班長' };
}

// ------------------------------------------------------------------
// Course Admin Actions (Groups & Courses)
// ------------------------------------------------------------------

export async function createCourseGroup(title: string, registration_start?: Date | null, registration_end?: Date | null): Promise<{ success: boolean; message: string; id?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Verify current user is admin
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以建立課程檔期');

    const { data, error } = await supabase
        .from('course_groups')
        .insert({ 
            title, 
            created_by: user.id,
            registration_phase1_start: registration_start ? registration_start.toISOString() : null,
            registration_phase1_end: registration_end ? registration_end.toISOString() : null
        })
        .select()
        .single();

    if (error) throw new Error(`建立檔期失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: '成功建立課程檔期', id: data.id };
}

export async function updateCourseGroup(id: string, title: string, registration_start?: Date | null, registration_end?: Date | null): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Verify current user is admin
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以修改課程檔期');

    const { error } = await supabase
        .from('course_groups')
        .update({ 
            title,
            registration_phase1_start: registration_start ? registration_start.toISOString() : null,
            registration_phase1_end: registration_end ? registration_end.toISOString() : null
        })
        .eq('id', id);

    if (error) throw new Error(`修正檔期失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: '成功修正課程檔期資訊' };
}

export async function deleteCourseGroup(id: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Verify current user is admin
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以刪除課程檔期');

    // Check if courses exist in this group
    const { count, error: countError } = await supabase
        .from('courses')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', id);

    if (countError) throw new Error(`讀取課程資訊失敗: ${countError.message}`);
    if ((count ?? 0) > 0) {
        throw new Error('此檔期下尚有課程，請先移除所有相關課程後再刪除檔期。');
    }

    const { error } = await supabase
        .from('course_groups')
        .delete()
        .eq('id', id);

    if (error) throw new Error(`刪除檔期失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: '成功刪除課程檔期' };
}

export async function createCourse(data: any): Promise<{ success: boolean; message: string; id?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Admin check
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以建立課程');

    // 1. Insert Course
    const { data: course, error: courseError } = await supabase
        .from('courses')
        .insert({
            group_id: data.groupId,
            name: data.name,
            description: data.description,
            type: data.type,
            teacher: data.teacher,
            room: data.room,
            start_time: data.start_time,
            end_time: data.end_time,
            capacity: data.capacity,
            cards_per_session: data.cards_per_session ?? 1,
            enrollment_start_at: data.enrollment_start_at ? data.enrollment_start_at.toISOString() : null,
            enrollment_end_at: data.enrollment_end_at ? data.enrollment_end_at.toISOString() : null,
            created_by: user.id
        })
        .select()
        .single();

    if (courseError) throw new Error(`建立課程失敗: ${courseError.message}`);

    // 2. Insert Sessions (sort by date to assign correct session_number)
    const sortedSessions = [...data.sessions].sort((a: any, b: any) => {
        const dateA = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
        const dateB = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
        return dateA - dateB;
    });
    const sessions = sortedSessions.map((s: any, index: number) => ({
        course_id: course.id,
        session_date: s.date instanceof Date ? s.date.toISOString().split('T')[0] : s.date,
        session_number: index + 1
    }));

    const { error: sessionError } = await supabase.from('course_sessions').insert(sessions);
    if (sessionError) throw new Error(`建立課程時段失敗: ${sessionError.message}`);

    // 3. Handle Leader
    if (data.leader && data.leader !== 'none') {
        const { data: leaderProfile } = await supabase.from('profiles').select('id').eq('name', data.leader).maybeSingle();
        if (leaderProfile) {
            await assignCourseLeader(course.id, leaderProfile.id);
        } else if (data.leader.length > 20) { // Likely a UUID
            await assignCourseLeader(course.id, data.leader);
        }
    }

    revalidatePath('/', 'layout');
    return { success: true, message: '成功建立課程', id: course.id };
}

export async function updateCourse(id: string, data: any): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Admin check
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以更新課程');

    // 1. Update Course
    const { error: courseError } = await supabase
        .from('courses')
        .update({
            group_id: data.groupId,
            name: data.name,
            description: data.description,
            type: data.type,
            teacher: data.teacher,
            room: data.room,
            start_time: data.start_time,
            end_time: data.end_time,
            capacity: data.capacity,
            cards_per_session: data.cards_per_session ?? 1,
            enrollment_start_at: data.enrollment_start_at ? data.enrollment_start_at.toISOString() : null,
            enrollment_end_at: data.enrollment_end_at ? data.enrollment_end_at.toISOString() : null,
        })
        .eq('id', id);

    if (courseError) throw new Error(`更新課程失敗: ${courseError.message}`);

    // 2. Sync Sessions (sort by date to assign correct session_number)
    const sortedNextSessions = [...data.sessions].map((s: any) => {
        let dateStr = s.date;
        if (s.date instanceof Date) {
            const y = s.date.getFullYear();
            const m = String(s.date.getMonth() + 1).padStart(2, '0');
            const d = String(s.date.getDate()).padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
        } else if (typeof s.date === 'string' && s.date.includes('T')) {
            dateStr = s.date.split('T')[0];
        }
        return { ...s, session_date: dateStr };
    }).sort((a: any, b: any) => a.session_date.localeCompare(b.session_date));

    const nextSessions = sortedNextSessions.map((s: any, index: number) => ({
        id: s.id,
        course_id: id,
        session_date: s.session_date,
        session_number: index + 1
    }));

    // Identify sessions to delete
    const nextSessionIds = nextSessions.filter((s: any) => s.id).map((s: any) => s.id);
    const { data: existingSessions } = await supabase
        .from('course_sessions')
        .select('id')
        .eq('course_id', id);

    const idsToRemove = existingSessions?.filter(es => !nextSessionIds.includes(es.id)).map(es => es.id) || [];

    if (idsToRemove.length > 0) {
        // DATA INTEGRITY CHECK: Block deletion if session has critical data
        // Check Attendance
        const { count: attendanceCount } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .in('session_id', idsToRemove);

        if (attendanceCount && attendanceCount > 0) {
            throw new Error('無法刪除已有紀錄的課堂。此堂課已有學員點名、請假或轉讓紀錄，如需異動請洽系統幹部。');
        }

        // Check Requests (Leave, Makeup, Transfer)
        const [leaveRes, makeupRes, transferRes] = await Promise.all([
            supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('session_id', idsToRemove),
            supabase.from('makeup_requests').select('id', { count: 'exact', head: true }).or(`original_session_id.in.(${idsToRemove.join(',')}),target_session_id.in.(${idsToRemove.join(',')})`),
            supabase.from('transfer_requests').select('id', { count: 'exact', head: true }).in('session_id', idsToRemove)
        ]);

        if ((leaveRes.count || 0) > 0 || (makeupRes.count || 0) > 0 || (transferRes.count || 0) > 0) {
            throw new Error('無法刪除已有紀錄的課堂。此堂課已有學員點名、請假或轉讓紀錄，如需異動請洽系統幹部。');
        }
    }

    // Upsert sessions
    for (const [index, session] of nextSessions.entries()) {
        const sessionData = {
            course_id: id,
            session_date: session.session_date,
            session_number: index + 1
        };

        if (session.id) {
            const { error: updateError } = await supabase
                .from('course_sessions')
                .update(sessionData)
                .eq('id', session.id);
            if (updateError) throw new Error(`更新課堂失敗: ${updateError.message}`);
        } else {
            const { error: insertError } = await supabase
                .from('course_sessions')
                .insert(sessionData);
            if (insertError) throw new Error(`新增課堂失敗: ${insertError.message}`);
        }
    }

    // Delete missing ones
    if (idsToRemove.length > 0) {
        const { error: deleteError } = await supabase
            .from('course_sessions')
            .delete()
            .in('id', idsToRemove);
        if (deleteError) throw new Error(`刪除多餘課堂失敗: ${deleteError.message}`);
    }

    // 3. Handle Leader
    if (data.leader && data.leader !== 'none') {
        // Find leader ID if it's a name
        const { data: leaderProfile } = await supabase.from('profiles').select('id').eq('name', data.leader).maybeSingle();
        const leaderId = leaderProfile?.id || (data.leader.length > 20 ? data.leader : null);

        if (leaderId) {
            // Check if already assigned
            const { data: currentLeader } = await supabase.from('course_leaders').select('user_id').eq('course_id', id).maybeSingle();
            if (currentLeader?.user_id !== leaderId) {
                if (currentLeader) {
                    await removeCourseLeader(id, currentLeader.user_id);
                }
                await assignCourseLeader(id, leaderId);
            }
        }
    } else {
        // Remove if 'none'
        const { data: currentLeader } = await supabase.from('course_leaders').select('user_id').eq('course_id', id).maybeSingle();
        if (currentLeader) {
            await removeCourseLeader(id, currentLeader.user_id);
        }
    }

    revalidatePath('/', 'layout');
    revalidatePath(`/courses/groups/${data.groupId}/${id}`);
    return { success: true, message: '成功更新課程' };
}

// ------------------------------------------------------------------
// Attendance Actions
// ------------------------------------------------------------------

/**
 * Upsert multiple attendance records for a session.
 * records: array of { userId, status, note? }
 */
export async function saveAttendance(
    sessionId: string,
    records: { userId: string; status: string; note?: string }[]
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const upserts = records.map(r => ({
        session_id: sessionId,
        user_id: r.userId,
        status: r.status,
        note: r.note ?? null,
        marked_by: user.id,
        marked_at: new Date().toISOString(),
    }));

    const { error } = await supabase
        .from('attendance_records')
        .upsert(upserts, { onConflict: 'session_id,user_id' });

    if (error) throw new Error(`儲存點名失敗: ${error.message}`);

    const { data: session } = await supabase
        .from('course_sessions')
        .select('course_id')
        .eq('id', sessionId)
        .maybeSingle();

    if (session) revalidatePath('/', 'layout');
    return { success: true, message: '點名已儲存' };
}

// ------------------------------------------------------------------
// Leave Request Actions
// ------------------------------------------------------------------

export async function submitLeaveRequest(
    courseId: string,
    sessionId: string,
    reason?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Check user is enrolled (full term) OR has an approved makeup/transfer_in for this session
    const [{ data: enrollments }, { data: makeupForSession }, { data: transferInForSession }] = await Promise.all([
        supabase
            .from('enrollments')
            .select('id, type')
            .eq('course_id', courseId)
            .eq('user_id', user.id)
            .eq('status', 'enrolled'),
        supabase
            .from('makeup_requests')
            .select('id')
            .eq('target_course_id', courseId)
            .eq('target_session_id', sessionId)
            .eq('user_id', user.id)
            .eq('status', 'approved')
            .limit(1),
        supabase
            .from('transfer_requests')
            .select('id')
            .eq('course_id', courseId)
            .eq('session_id', sessionId)
            .eq('to_user_id', user.id)
            .eq('status', 'approved')
            .limit(1),
    ]);

    const enrollment = enrollments?.[0];
    const hasMakeupForSession = (makeupForSession?.length ?? 0) > 0;
    const hasTransferInForSession = (transferInForSession?.length ?? 0) > 0;

    if (!enrollment && !hasMakeupForSession && !hasTransferInForSession) throw new Error('您未報名此課程，無法申請請假');

    // --- Date Guard: cannot take leave on past sessions ---
    const { data: sessionInfo } = await supabase
        .from('course_sessions')
        .select('session_date, courses ( start_time )')
        .eq('id', sessionId)
        .maybeSingle();
    if (sessionInfo && !isBeforeClass(sessionInfo.session_date, (sessionInfo.courses as any)?.start_time ?? '00:00')) {
        throw new Error('課程已開始或已結束，無法申請請假');
    }

    // --- Dual Status Guard ---
    // Guard: Prevent duplicate leave intents. If one exists, we will update it.
    const { data: existingLeave } = await supabase
        .from('leave_requests')
        .select('id, status')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (existingLeave && existingLeave.status !== 'rejected' && existingLeave.status !== 'approved') {
        throw new Error('此堂課已有審核中的請假紀錄');
    }

    // Guard: Prevent leave if a transfer request already exists for this session
    const { data: existingTransfer } = await supabase
        .from('transfer_requests')
        .select('id, status')
        .eq('session_id', sessionId)
        .eq('from_user_id', user.id)
        .neq('status', 'rejected')
        .maybeSingle();

    if (existingTransfer) {
        throw new Error('此堂課已有轉讓申請，無法重複申請請假');
    }

    // Guard: Prevent leave if already marked as something other than 'unmarked'
    const { data: currentAttendance } = await supabase
        .from('attendance_records')
        .select('status')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (currentAttendance?.status && currentAttendance.status !== 'unmarked' && currentAttendance.status !== 'present' && currentAttendance.status !== 'absent' && currentAttendance.status !== 'makeup' && currentAttendance.status !== 'transfer_in') {
        throw new Error('此堂課已有特殊出席狀態（如轉出），無法申請請假');
    }

    const payload = {
        course_id: courseId,
        session_id: sessionId,
        user_id: user.id,
        reason: reason ?? null,
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
    };

    let error;
    if (existingLeave) {
        const res = await supabase.from('leave_requests').update(payload).eq('id', existingLeave.id);
        error = res.error;
    } else {
        const res = await supabase.from('leave_requests').insert(payload);
        error = res.error;
    }

    if (error) throw new Error(`請假申請失敗: ${error.message}`);

    // --- NEW: Cross-Intent Cleanup ---
    // Since student is now LEAVING, remove any existing Transfer or Makeup intents for this slot
    await Promise.all([
        supabase.from('transfer_requests').delete().eq('session_id', sessionId).eq('from_user_id', user.id),
        supabase.from('makeup_requests').delete().eq('original_session_id', sessionId).eq('user_id', user.id).eq('status', 'pending')
    ]);

    // Update attendance record immediately
    await supabase.from('attendance_records').upsert({
        session_id: sessionId,
        user_id: user.id,
        status: 'leave',
        marked_by: user.id,
        marked_at: new Date().toISOString(),
    }, { onConflict: 'session_id,user_id' });

    revalidatePath(`/`, `layout`);
    return { success: true, message: '請假成功，已更新點名單' };
}

const ATTENDANCE_LABELS: Record<string, string> = {
    leave: '請假',
    transfer_out: '轉出',
    transfer_in: '轉入',
    makeup: '補課',
    present: '出席',
    absent: '缺席',
    unmarked: '待點名'
};

export async function reviewLeaveRequest(
    requestId: string,
    decision: 'approved' | 'rejected',
    reviewNote?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: req } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();

    if (!req) throw new Error('找不到申請記錄');

    // 1. Guard check if approving
    if (decision === 'approved') {
        const { data: current } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('session_id', req.session_id)
            .eq('user_id', req.user_id)
            .maybeSingle();

        if (current?.status && !['unmarked', 'present', 'absent', 'leave'].includes(current.status)) {
            const label = ATTENDANCE_LABELS[current.status] || current.status;
            throw new Error(`此堂課已有其他生效中的記錄 (${label})，無法重新核准。請先處理現有記錄。`);
        }
    }

    // 2. Perform the status update
    const { error } = await supabase
        .from('leave_requests')
        .update({
            status: decision,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
            review_note: reviewNote ?? null,
        })
        .eq('id', requestId);

    if (error) throw new Error(`審核失敗: ${error.message}`);

    // 3. Post-update side effects
    if (decision === 'approved') {
        await supabase
            .from('attendance_records')
            .upsert({
                session_id: req.session_id,
                user_id: req.user_id,
                status: 'leave',
                marked_by: user.id,
                marked_at: new Date().toISOString(),
            }, { onConflict: 'session_id,user_id' });

        // Cleanup: remove competing records from other tables
        await Promise.all([
            supabase.from('transfer_requests').delete().eq('session_id', req.session_id).eq('from_user_id', req.user_id),
            supabase.from('makeup_requests').delete().eq('original_session_id', req.session_id).eq('user_id', req.user_id).eq('status', 'pending')
        ]);
    } else {
        // If rejected, restore attendance to previous state
        // Check if this was a makeup student — restore to 'makeup' instead of deleting
        const { data: makeupCheck } = await supabase
            .from('makeup_requests')
            .select('id')
            .eq('target_session_id', req.session_id)
            .eq('user_id', req.user_id)
            .eq('status', 'approved')
            .limit(1);

        if (makeupCheck && makeupCheck.length > 0) {
            await supabase
                .from('attendance_records')
                .upsert({
                    session_id: req.session_id,
                    user_id: req.user_id,
                    status: 'makeup',
                    marked_by: user.id,
                    marked_at: new Date().toISOString(),
                }, { onConflict: 'session_id,user_id' });
        } else {
            // Check if transfer_in student — restore to 'transfer_in'
            const { data: transferCheck } = await supabase
                .from('transfer_requests')
                .select('id')
                .eq('session_id', req.session_id)
                .eq('to_user_id', req.user_id)
                .eq('status', 'approved')
                .limit(1);

            if (transferCheck && transferCheck.length > 0) {
                await supabase
                    .from('attendance_records')
                    .upsert({
                        session_id: req.session_id,
                        user_id: req.user_id,
                        status: 'transfer_in',
                        marked_by: user.id,
                        marked_at: new Date().toISOString(),
                    }, { onConflict: 'session_id,user_id' });
            } else {
                // Regular student: remove the leave attendance record
                await supabase
                    .from('attendance_records')
                    .delete()
                    .eq('session_id', req.session_id)
                    .eq('user_id', req.user_id)
                    .eq('status', 'leave');
            }
        }
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准請假' : '已駁回請假' };
}

// ------------------------------------------------------------------
// Makeup Request Actions
// ------------------------------------------------------------------

/**
 * Internal helper for single makeup request submission logic.
 * This is used by both submitMakeupRequest and batchSubmitMakeupRequests.
 */
async function internalSubmitMakeupRequest(
    supabase: any,
    user: { id: string },
    originalCourseId: string,
    originalSessionId: string | null,
    targetCourseId: string,
    targetSessionId: string
): Promise<{ success: boolean; message: string }> {
    // Check original/target courses
    const [originalCourseRes, targetRes, enrollmentsRes] = await Promise.all([
        supabase.from('courses').select('group_id, type').eq('id', originalCourseId).maybeSingle(),
        supabase.from('course_sessions').select('course_id, session_date, courses ( group_id, capacity, start_time )').eq('id', targetSessionId).maybeSingle(),
        supabase.from('enrollments').select('type').eq('course_id', originalCourseId).eq('user_id', user.id).eq('status', 'enrolled'),
    ]);

    let originalCourse = originalCourseRes.data;
    const target = targetRes.data;
    let enrollments = enrollmentsRes.data || [];
    let userEnrollment = enrollments.find((e: any) => e.type === 'full') || enrollments[0];
    let effectiveOriginalCourseId = originalCourseId;

    if (!target) throw new Error('目標堂次不存在');

    // Date guard: cannot makeup into a past session
    if (!isBeforeClass(target.session_date, (target.courses as any)?.start_time ?? '00:00')) {
        throw new Error('目標堂次已開始或已結束，無法申請補課');
    }

    // Fetch manual makeup_quota adjustment from profile
    const { data: userProfile } = await supabase
        .from('profiles')
        .select('makeup_quota')
        .eq('id', user.id)
        .single();
    const manualAdj = userProfile?.makeup_quota || 0;

    // Quota-only mode: no specific original session, originalCourseId may be wrong (defaulted to target)
    // Find the user's actual full-enrolled normal/special course in the same group that has remaining quota
    const isQuotaOnlyMode = !originalSessionId && !userEnrollment;
    if (isQuotaOnlyMode) {
        const tGroup = (target.courses as any)?.group_id;
        const { data: groupEnrollments } = await supabase
            .from('enrollments')
            .select('course_id, courses!inner ( id, type, group_id )')
            .eq('user_id', user.id)
            .eq('type', 'full')
            .eq('status', 'enrolled')
            .eq('courses.group_id', tGroup)
            .in('courses.type', ['normal', 'special']);

        if (!groupEnrollments || groupEnrollments.length === 0) {
            throw new Error('您未報名此期課程，無法申請補課');
        }

        // Find a course with remaining quota
        const courseIds = groupEnrollments.map((e: any) => e.course_id);
        const [sessionsRes, makeupReqRes, transferReqRes] = await Promise.all([
            supabase.from('course_sessions').select('course_id').in('course_id', courseIds),
            supabase.from('makeup_requests').select('original_course_id, quota_used').eq('user_id', user.id).in('original_course_id', courseIds).in('status', ['pending', 'approved']),
            supabase.from('transfer_requests').select('course_id').eq('from_user_id', user.id).in('course_id', courseIds).eq('status', 'approved'),
        ]);

        const sessionCounts: Record<string, number> = {};
        (sessionsRes.data ?? []).forEach((s: any) => { sessionCounts[s.course_id] = (sessionCounts[s.course_id] ?? 0) + 1; });
        const makeupUsed: Record<string, number> = {};
        (makeupReqRes.data ?? []).forEach((m: any) => { makeupUsed[m.original_course_id] = (makeupUsed[m.original_course_id] ?? 0) + Number(m.quota_used); });
        const transferUsed: Record<string, number> = {};
        (transferReqRes.data ?? []).forEach((t: any) => { transferUsed[t.course_id] = (transferUsed[t.course_id] ?? 0) + 1; });

        let foundCourseId: string | null = null;
        for (const cid of courseIds) {
            const total = computeMakeupQuota(sessionCounts[cid] ?? 0);
            const used = (makeupUsed[cid] ?? 0) + (transferUsed[cid] ?? 0);
            if (used < total) { foundCourseId = cid; break; }
        }

        if (!foundCourseId) {
            const computedTotal = courseIds.reduce((s: number, cid: string) => s + computeMakeupQuota(sessionCounts[cid] ?? 0), 0);
            const totalAll = computedTotal + manualAdj;
            const usedAll = courseIds.reduce((s: number, cid: string) => s + (makeupUsed[cid] ?? 0) + (transferUsed[cid] ?? 0), 0);
            if (usedAll < totalAll) {
                // Manual adjustment provides extra quota — use the first course as source
                foundCourseId = courseIds[0];
            } else {
                return { success: false, message: `補課/轉讓額度已用完（${usedAll}/${totalAll}）` };
            }
        }

        effectiveOriginalCourseId = foundCourseId!;
        const { data: foundCourse } = await supabase
            .from('courses')
            .select('group_id, type')
            .eq('id', effectiveOriginalCourseId)
            .maybeSingle();
        originalCourse = foundCourse;
        enrollments = [{ type: 'full' }];
        userEnrollment = { type: 'full' };
    }

    if (!originalCourse) throw new Error('原始課程不存在');
    if (!userEnrollment) throw new Error('您未報名原始課程');

    // Rule 0: Cannot makeup in a course you are already full-term enrolled in,
    // or if you already have the specific target session (single enrollment / makeup / transfer_in)
    const [{ data: fullEnrollCheck }, { data: sessionOccupyCheck }] = await Promise.all([
        supabase
            .from('enrollments')
            .select('id')
            .eq('course_id', target.course_id)
            .eq('user_id', user.id)
            .eq('status', 'enrolled')
            .eq('type', 'full')
            .limit(1)
            .maybeSingle(),
        supabase
            .from('enrollments')
            .select('id')
            .eq('session_id', targetSessionId)
            .eq('user_id', user.id)
            .eq('status', 'enrolled')
            .limit(1)
            .maybeSingle(),
    ]);

    if (fullEnrollCheck) throw new Error('您已整期報名目標課程，無需申請補課');
    if (sessionOccupyCheck) throw new Error('您已報名該堂次，無需申請補課');

    // Also check existing makeup or transfer_in for this session
    const [{ data: dupMakeup }, { data: dupTransferIn }] = await Promise.all([
        supabase.from('makeup_requests').select('id')
            .eq('target_session_id', targetSessionId).eq('user_id', user.id).in('status', ['pending', 'approved']).limit(1).maybeSingle(),
        supabase.from('transfer_requests').select('id')
            .eq('session_id', targetSessionId).eq('to_user_id', user.id).eq('status', 'approved').limit(1).maybeSingle(),
    ]);
    if (dupMakeup) throw new Error('您已有該堂次的補課申請');
    if (dupTransferIn) throw new Error('您已透過轉讓進入該堂次');

    // Rule 1: No cross-period makeup
    const targetGroup = (target.courses as any)?.group_id;
    if (originalCourse.group_id !== targetGroup) {
        throw new Error('不支援跨期補課，請選擇相同檔期的課程');
    }

    // Rule 2: Only full-term enrollees can makeup
    if (userEnrollment?.type !== 'full') {
        throw new Error('單堂報名學員不支援補課申請');
    }

    // --- Quota Calculation (For 'normal' and 'special' courses) ---
    if (!isQuotaOnlyMode && (originalCourse.type === 'normal' || originalCourse.type === 'special')) {
        const { count: sessionsCount } = await supabase
            .from('course_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', effectiveOriginalCourseId);

        const totalQuota = computeMakeupQuota(sessionsCount ?? 8) + manualAdj;
        const usedMakeup = await getUserMakeupQuotaUsed(user.id, effectiveOriginalCourseId);
        const usedTransfer = await getUserTransferCount(user.id, effectiveOriginalCourseId);
        const totalUsed = usedMakeup + usedTransfer;

        if (totalUsed >= totalQuota) {
            return { success: false, message: `補課/轉讓額度已用完（${totalUsed}/${totalQuota}）` };
        }
    }

    // --- Capacity Guard ---
    const [baseEnrollRes, makeupRes, leaveRes, transferRes] = await Promise.all([
        supabase.from('enrollments').select('*', { count: 'exact', head: true }).eq('course_id', target.course_id).eq('status', 'enrolled').or(`type.eq.full,session_id.eq.${targetSessionId}`),
        supabase.from('makeup_requests').select('*', { count: 'exact', head: true }).eq('target_session_id', targetSessionId).eq('status', 'approved'),
        supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('session_id', targetSessionId).eq('status', 'approved'),
        supabase.from('transfer_requests').select('to_user_id').eq('course_id', target.course_id).eq('session_id', targetSessionId).eq('status', 'approved'),
    ]);

    const baseCount = baseEnrollRes.count ?? 0;
    const makeupCount = makeupRes.count ?? 0;
    const leaveCount = leaveRes.count ?? 0;
    const transferInCount = (transferRes.data ?? []).filter((t: any) => !!t.to_user_id).length;
    const transferOutCount = (transferRes.data ?? []).length;

    const effectiveOccupied = baseCount + makeupCount + transferInCount - leaveCount - transferOutCount;
    if (effectiveOccupied >= (target.courses as any).capacity) {
        throw new Error('目標堂次已滿人，無法提交補課申請');
    }

    // --- Duplicate Guard ---
    const { data: existingMakeup } = await supabase
        .from('makeup_requests')
        .select('id, status')
        .eq('target_session_id', targetSessionId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (existingMakeup && existingMakeup.status !== 'rejected' && existingMakeup.status !== 'approved') {
        throw new Error('您已對此堂次提交過進行中的補課申請');
    }

    // Guard: Prevent makeup if a transfer already exists for the ORIGINAL session
    if (originalSessionId) {
        const { data: existingTransferForOriginal } = await supabase
            .from('transfer_requests')
            .select('id')
            .eq('session_id', originalSessionId)
            .eq('from_user_id', user.id)
            .neq('status', 'rejected')
            .maybeSingle();

        if (existingTransferForOriginal) {
            throw new Error('此堂課已有轉讓申請，無法重複申請補課');
        }
    }

    let quotaUsed = 1;
    const payload = {
        original_course_id: effectiveOriginalCourseId,
        original_session_id: originalSessionId,
        target_course_id: target.course_id,
        target_session_id: targetSessionId,
        user_id: user.id,
        status: 'approved',
        quota_used: quotaUsed,
        reviewed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
    };

    let error;
    if (existingMakeup) {
        const res = await supabase.from('makeup_requests').update(payload).eq('id', existingMakeup.id);
        error = res.error;
    } else {
        const res = await supabase.from('makeup_requests').insert(payload);
        error = res.error;
    }

    if (error) throw new Error(`補課申請失敗: ${error.message}`);

    // Cleanup: Remove competing Leave/Transfer intents for the ORIGINAL session
    if (originalSessionId) {
        await Promise.all([
            supabase.from('leave_requests').delete().eq('session_id', originalSessionId).eq('user_id', user.id),
            supabase.from('transfer_requests').delete().eq('session_id', originalSessionId).eq('from_user_id', user.id)
        ]);
    }

    // Update attendance record immediately for target session
    await supabase.from('attendance_records').upsert({
        session_id: targetSessionId,
        user_id: user.id,
        status: 'makeup',
        marked_by: user.id,
        marked_at: new Date().toISOString(),
    }, { onConflict: 'session_id,user_id' });

    return { success: true, message: '成功' };
}

export async function submitMakeupRequest(
    originalCourseId: string,
    originalSessionId: string | null,
    targetCourseId: string,
    targetSessionId: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();
    const result = await internalSubmitMakeupRequest(supabase, user, originalCourseId, originalSessionId, targetCourseId, targetSessionId);
    
    if (result.success) {
        revalidatePath('/', 'layout');
        return { success: true, message: `補課成功！已扣除 1 額度，並更新目標堂次名單。` };
    }
    return result;
}

/**
 * Batch makeup requests logic.
 * Pairs each target session with the oldest available missed session from the same group.
 */
export async function batchSubmitMakeupRequests(
    targetCourseId: string,
    targetSessionIds: string[]
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();
    
    // 1. Get available missed sessions (sorted by date)
    const { getAvailableMakeupQuotaSessions } = await import('./queries');
    const { sessions: available } = await getAvailableMakeupQuotaSessions(user.id);

    // Get target group ID
    const { data: targetCourse } = await supabase.from('courses').select('group_id').eq('id', targetCourseId).single();
    if (!targetCourse) throw new Error('目標課程不存在');

    // Filter by same group and only those with quota available
    let availableQuotaSessions = available
        .filter((s: any) => s.groupId === targetCourse.group_id && !s.isQuotaFull)
        .sort((a: any, b: any) => a.date.localeCompare(b.date));

    if (availableQuotaSessions.length < targetSessionIds.length) {
        throw new Error(`補課額度不足。您選擇了 ${targetSessionIds.length} 堂課，但只有 ${availableQuotaSessions.length} 個可用額度。`);
    }

    // 2. Pair and submit
    const results = [];
    for (let i = 0; i < targetSessionIds.length; i++) {
        const targetSid = targetSessionIds[i];
        const source = availableQuotaSessions[i];
        
        try {
            const res = await internalSubmitMakeupRequest(
                supabase, 
                user, 
                source.courseId, 
                source.sessionId, 
                targetCourseId, 
                targetSid
            );
            results.push(res);
        } catch (err: any) {
            throw new Error(`處理第 ${i+1} 堂補課時發生錯誤: ${err.message}`);
        }
    }

    revalidatePath('/', 'layout');
    return { success: true, message: `成功完成 ${targetSessionIds.length} 堂補課申請！` };
}


export async function reviewMakeupRequest(
    requestId: string,
    decision: 'approved' | 'rejected',
    reviewNote?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: req } = await supabase
        .from('makeup_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();

    if (!req) throw new Error('找不到申請記錄');

    // 1. Guard check if approving
    if (decision === 'approved') {
        const { data: current } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('session_id', req.target_session_id)
            .eq('user_id', req.user_id)
            .maybeSingle();

        if (current?.status && !['unmarked', 'present', 'absent', 'makeup'].includes(current.status)) {
            const label = ATTENDANCE_LABELS[current.status] || current.status;
            throw new Error(`目標堂次已有其他生效中的記錄 (${label})，無法核准補課申請。`);
        }
    }

    // 2. Perform the status update
    const { error } = await supabase
        .from('makeup_requests')
        .update({
            status: decision,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
            review_note: reviewNote ?? null,
        })
        .eq('id', requestId);

    if (error) throw new Error(`審核失敗: ${error.message}`);

    // 3. Post-update side effects
    if (decision === 'approved') {
        await supabase
            .from('attendance_records')
            .upsert({
                session_id: req.target_session_id,
                user_id: req.user_id,
                status: 'makeup',
                marked_by: user.id,
                marked_at: new Date().toISOString(),
            }, { onConflict: 'session_id,user_id' });
    } else {
        // If rejected, wipe the attendance record to clear the slot
        await supabase
            .from('attendance_records')
            .delete()
            .eq('session_id', req.target_session_id)
            .eq('user_id', req.user_id);
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准補課' : '已駁回補課' };
}

// ------------------------------------------------------------------
// Transfer Candidate Lookup
// ------------------------------------------------------------------

export async function getTransferCandidates(
    courseId: string,
    sessionId?: string
): Promise<{
    waitlist: { id: string; name: string; role: string; position: number; employee_id?: string | null }[];
    allMembers: { id: string; name: string; role: string; employee_id?: string | null }[];
}> {
    const { supabase, user } = await getCurrentUser();

    // 1. Get waitlisted users for this course (ordered by position)
    const { data: waitlistData } = await supabase
        .from('enrollments')
        .select('waitlist_position, profiles ( id, name, role, employee_id )')
        .eq('course_id', courseId)
        .eq('status', 'waitlist')
        .order('waitlist_position');

    const waitlist = (waitlistData ?? [])
        .map((w: any) => ({
            id: w.profiles?.id ?? '',
            name: w.profiles?.name ?? '未知',
            role: w.profiles?.role ?? 'guest',
            position: w.waitlist_position ?? 0,
            employee_id: w.profiles?.employee_id,
        }))
        .filter((w: any) => w.id && w.id !== user.id && w.role !== 'guest');

    // 2. Exclude: self, full-term enrolled, and anyone already occupying this specific session
    const excludeIds = new Set<string>();
    excludeIds.add(user.id);

    // Full-term enrolled students
    const { data: fullEnrolled } = await supabase
        .from('enrollments')
        .select('user_id')
        .eq('course_id', courseId)
        .eq('status', 'enrolled')
        .eq('type', 'full');
    (fullEnrolled ?? []).forEach(e => excludeIds.add(e.user_id));

    // If sessionId provided, also exclude users who already have that session
    if (sessionId) {
        const [{ data: singleEnrolled }, { data: makeupUsers }, { data: transferInUsers }] = await Promise.all([
            // Single-session enrolled for this specific session
            supabase.from('enrollments').select('user_id')
                .eq('course_id', courseId).eq('session_id', sessionId).eq('status', 'enrolled').eq('type', 'single'),
            // Approved makeup targeting this session
            supabase.from('makeup_requests').select('user_id')
                .eq('target_session_id', sessionId).eq('status', 'approved'),
            // Approved transfer_in for this session
            supabase.from('transfer_requests').select('to_user_id')
                .eq('session_id', sessionId).eq('status', 'approved').not('to_user_id', 'is', null),
        ]);
        (singleEnrolled ?? []).forEach(e => excludeIds.add(e.user_id));
        (makeupUsers ?? []).forEach(m => excludeIds.add(m.user_id));
        (transferInUsers ?? []).forEach(t => excludeIds.add(t.to_user_id));
    }

    const { data: membersData } = await supabase
        .from('profiles')
        .select('id, name, role, employee_id')
        .order('name');

    const allMembers = (membersData ?? [])
        .filter(m => !excludeIds.has(m.id) && m.role !== 'guest')
        .map((m: any) => ({
            id: m.id,
            name: m.name ?? '未知',
            role: m.role ?? 'guest',
            employee_id: m.employee_id,
        }));

    return { waitlist, allMembers };
}

// ------------------------------------------------------------------
// Transfer Request Actions
// ------------------------------------------------------------------

export async function submitTransferRequest(
    courseId: string,
    sessionId: string,
    toUserId: string | null,
    toUserName?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Check quota and enrollment type
    const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, type')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .eq('status', 'enrolled');

    const enrollment = enrollments?.find(e => e.type === 'full') || enrollments?.[0];

    if (!enrollment) throw new Error('您未報名此課程');
    // Workshop courses allow ALL enrollment types to transfer; others require full enrollment
    if (enrollment.type !== 'full') {
        const { data: courseForTypeCheck } = await supabase.from('courses').select('type').eq('id', courseId).maybeSingle();
        if (courseForTypeCheck?.type !== 'workshop') {
            throw new Error('單堂報名不支援轉讓申請');
        }
    }

    // Check time limit: must be before class starts
    const { data: session } = await supabase
        .from('course_sessions')
        .select('session_date, courses ( start_time )')
        .eq('id', sessionId)
        .maybeSingle();

    if (!session) throw new Error('堂次不存在');

    const courseData = session.courses as any;
    if (!isBeforeClass(session.session_date, courseData?.start_time ?? '00:00')) {
        throw new Error('課程已開始，無法進行轉讓');
    }
    // --- Course type check: normal/special/workshop support transfer ---
    const { data: courseMeta } = await supabase.from('courses').select('type').eq('id', courseId).maybeSingle();

    if (courseMeta?.type !== 'normal' && courseMeta?.type !== 'special' && courseMeta?.type !== 'workshop') {
        return { success: false, message: '此課程類型不支援轉讓，請改用請假功能（將釋出報名名額）' };
    }

    // Quota check: only normal/special courses have quota limits; workshop has NO quota
    if (courseMeta?.type === 'normal' || courseMeta?.type === 'special') {
        const { count: sessionsCount } = await supabase
            .from('course_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', courseId);

        const totalQuota = computeMakeupQuota(sessionsCount ?? 8);
        const usedMakeup = await getUserMakeupQuotaUsed(user.id, courseId);
        const usedTransfer = await getUserTransferCount(user.id, courseId);

        if (usedMakeup + usedTransfer >= totalQuota) {
            return { success: false, message: `補課/轉讓額度已用完（${usedMakeup + usedTransfer}/${totalQuota}）` };
        }
    }

    if (toUserId) {
        // ALL course types: recipient must be a member
        const { data: toProfile } = await supabase.from('profiles').select('role').eq('id', toUserId).maybeSingle();
        if (toProfile?.role === 'guest') {
            return { success: false, message: '轉讓對象必須為具備社員身分之成員' };
        }

        // Guard: Prevent transfer to a user who is already fully enrolled, or already enrolled in this session
        const { data: targetEnrollments } = await supabase
            .from('enrollments')
            .select('type, session_id')
            .eq('course_id', courseId)
            .eq('user_id', toUserId)
            .eq('status', 'enrolled');

        if (targetEnrollments && targetEnrollments.length > 0) {
            const hasFull = targetEnrollments.some(e => e.type === 'full');
            const hasSingleSelected = targetEnrollments.some(e => e.type === 'single' && e.session_id === sessionId);
            if (hasFull) throw new Error('對方已是本班全期學員，無法轉讓');
            if (hasSingleSelected) throw new Error('對方已單堂報名此堂課，無法再次轉入');
        }
    }

    // Guard: Prevent duplicate transfer requests for same session. Reuse if exists.
    const { data: existingTransfer } = await supabase
        .from('transfer_requests')
        .select('id, status')
        .eq('session_id', sessionId)
        .eq('from_user_id', user.id)
        .maybeSingle();

    if (existingTransfer && existingTransfer.status !== 'rejected' && existingTransfer.status !== 'approved') {
        throw new Error('此堂課已有審核中的轉讓紀錄');
    }

    // Guard: Prevent transfer if a leave request already exists for this session
    const { data: existingLeave } = await supabase
        .from('leave_requests')
        .select('id, status')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .neq('status', 'rejected')
        .maybeSingle();

    if (existingLeave) {
        throw new Error('此堂課已有請假申請，無法重複申請轉讓');
    }

    // Guard: Prevent transfer if already marked as something other than 'unmarked'
    const { data: currentAttendance } = await supabase
        .from('attendance_records')
        .select('status')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (currentAttendance?.status && currentAttendance.status !== 'unmarked' && currentAttendance.status !== 'present' && currentAttendance.status !== 'absent') {
        throw new Error('此堂課已有特殊出席狀態（如轉讓/補課），無法申請轉讓');
    }

    // Guard: Prevent transfer if a makeup request already exists for this original session
    const { data: existingMakeup } = await supabase
        .from('makeup_requests')
        .select('id')
        .eq('original_session_id', sessionId)
        .eq('user_id', user.id)
        .neq('status', 'rejected')
        .maybeSingle();

    if (existingMakeup) {
        throw new Error('此堂課已有補課申請，無法重複申請轉讓');
    }


    let extraCardsRequired = 0;

    const payload = {
        course_id: courseId,
        session_id: sessionId,
        from_user_id: user.id,
        to_user_id: toUserId,
        to_user_name: toUserName ?? null,
        extra_cards_required: extraCardsRequired,
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
    };

    let result;
    if (existingTransfer) {
        result = await supabase.from('transfer_requests').update(payload).eq('id', existingTransfer.id).select().single();
    } else {
        result = await supabase.from('transfer_requests').insert(payload).select().single();
    }

    const { error, data: newReq } = result;

    if (error) throw new Error(`轉讓申請失敗: ${error.message}`);

    // --- NEW: Cross-Intent Cleanup ---
    // Student is now TRANSFERRING, remove any existing Leave or Makeup intents for this slot
    await Promise.all([
        supabase.from('leave_requests').delete().eq('session_id', sessionId).eq('user_id', user.id),
        supabase.from('makeup_requests').delete().eq('original_session_id', sessionId).eq('user_id', user.id).eq('status', 'pending')
    ]);

    // Update attendance: sender = transfer_out, receiver = transfer_in
    await Promise.all([
        supabase.from('attendance_records').upsert({
            session_id: sessionId,
            user_id: user.id,
            status: 'transfer_out',
            marked_by: user.id,
            marked_at: new Date().toISOString(),
        }, { onConflict: 'session_id,user_id' }),
        toUserId ? supabase.from('attendance_records').upsert({
            session_id: sessionId,
            user_id: toUserId,
            status: 'transfer_in',
            marked_by: user.id,
            marked_at: new Date().toISOString(),
        }, { onConflict: 'session_id,user_id' }) : Promise.resolve(),
    ]);

    revalidatePath(`/`, `layout`);
    return { success: true, message: '轉讓成功，已更新點名單' };
}

export async function reviewTransferRequest(
    requestId: string,
    decision: 'approved' | 'rejected',
    reviewNote?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: req } = await supabase
        .from('transfer_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();

    if (!req) throw new Error('找不到申請記錄');

    // 1. Guard check if approving
    if (decision === 'approved') {
        const [fromAtt, toAtt] = await Promise.all([
            supabase.from('attendance_records').select('status').eq('session_id', req.session_id).eq('user_id', req.from_user_id).maybeSingle(),
            req.to_user_id ? supabase.from('attendance_records').select('status').eq('session_id', req.session_id).eq('user_id', req.to_user_id).maybeSingle() : Promise.resolve({ data: null })
        ]);

        if (fromAtt.data?.status && !['unmarked', 'present', 'absent', 'transfer_out'].includes(fromAtt.data.status)) {
            const label = ATTENDANCE_LABELS[fromAtt.data.status] || fromAtt.data.status;
            throw new Error(`轉出學員此堂課已有其他記錄 (${label})，無法重新核准轉讓。`);
        }
        if (toAtt.data?.status && !['unmarked', 'present', 'absent', 'transfer_in'].includes(toAtt.data.status)) {
            const label = ATTENDANCE_LABELS[toAtt.data.status] || toAtt.data.status;
            throw new Error(`轉入學員此堂課已有其他記錄 (${label})，無法重新核准轉讓。`);
        }
    }

    const { error } = await supabase
        .from('transfer_requests')
        .update({
            status: decision,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
            review_note: reviewNote ?? null,
        })
        .eq('id', requestId);

    if (error) throw new Error(`審核失敗: ${error.message}`);

    if (decision === 'approved') {

        // Mark original user as transfer_out, new user as transfer_in
        await supabase.from('attendance_records').upsert([
            {
                session_id: req.session_id,
                user_id: req.from_user_id,
                status: 'transfer_out',
                marked_by: user.id,
                marked_at: new Date().toISOString(),
            },
            ...(req.to_user_id ? [{
                session_id: req.session_id,
                user_id: req.to_user_id,
                status: 'transfer_in',
                marked_by: user.id,
                marked_at: new Date().toISOString(),
            }] : []),
        ], { onConflict: 'session_id,user_id' });

        // Cleanup: remove competing records
        await Promise.all([
            supabase.from('leave_requests').delete().eq('session_id', req.session_id).eq('user_id', req.from_user_id),
            supabase.from('makeup_requests').delete().eq('original_session_id', req.session_id).eq('user_id', req.from_user_id).eq('status', 'pending')
        ]);
    } else {
        // If rejected, delete ONLY IF it's currently a transfer status
        const deletePromises = [
            supabase.from('attendance_records').delete().eq('session_id', req.session_id).eq('user_id', req.from_user_id).eq('status', 'transfer_out')
        ];
        if (req.to_user_id) {
            deletePromises.push(
                supabase.from('attendance_records').delete().eq('session_id', req.session_id).eq('user_id', req.to_user_id).eq('status', 'transfer_in') as any
            );
        }
        await Promise.all(deletePromises);
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准轉讓' : '已駁回轉讓' };
}

// ------------------------------------------------------------------
// Member Group Actions
// ------------------------------------------------------------------

export async function createMemberGroup(
    name: string,
    validUntil: string
): Promise<{ success: boolean; message: string; id?: string }> {
    const { supabase, user } = await getCurrentUser();
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以建立年度群組');

    const { data, error } = await supabase
        .from('member_groups')
        .insert({ name, valid_until: validUntil })
        .select()
        .single();

    if (error) throw new Error(`建立群組失敗: ${error.message}`);
    revalidatePath('/', 'layout');
    return { success: true, message: `已建立「${name}」群組`, id: data.id };
}

export async function updateMemberGroup(
    id: string,
    name: string,
    validUntil: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以修改年度群組');

    const { error } = await supabase
        .from('member_groups')
        .update({ name, valid_until: validUntil })
        .eq('id', id);

    if (error) throw new Error(`修改群組失敗: ${error.message}`);
    revalidatePath('/', 'layout');
    return { success: true, message: '群組已更新' };
}

export async function deleteMemberGroup(
    id: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以刪除年度群組');

    // Check if any members are in this group
    const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('member_group_id', id);

    if (count && count > 0) {
        return { success: false, message: `此群組仍有 ${count} 位成員，請先將成員移至其他群組` };
    }

    const { error } = await supabase.from('member_groups').delete().eq('id', id);
    if (error) throw new Error(`刪除群組失敗: ${error.message}`);
    revalidatePath('/', 'layout');
    return { success: true, message: '群組已刪除' };
}

// ------------------------------------------------------------------
// Member Profile Actions
// ------------------------------------------------------------------

export async function updateMemberProfile(
    userId: string,
    data: { role?: string; member_group_id?: string | null; makeup_quota?: number }
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Admin check
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') return { success: false, message: '只有幹部可以修改成員資料' };

    const updateData: Record<string, any> = {};
    if (data.role !== undefined) {
        const allowedRole = data.role === 'leader' ? 'member' : data.role;
        updateData.role = allowedRole;
    }
    if (data.member_group_id !== undefined) updateData.member_group_id = data.member_group_id;
    if (data.makeup_quota !== undefined) updateData.makeup_quota = data.makeup_quota;

    if (Object.keys(updateData).length === 0) {
        return { success: false, message: '沒有要更新的欄位' };
    }

    const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId);

    if (error) return { success: false, message: `更新社員資料失敗: ${error.message}` };

    revalidatePath('/', 'layout');
    return { success: true, message: '社員資料已更新' };
}

// ------------------------------------------------------------------
// Registration (no email verification, uses admin API)
// ------------------------------------------------------------------

export async function registerUserAction(data: {
    email: string;
    password: string;
    name: string;
    employee_id?: string;
}): Promise<{ success: boolean; message: string }> {
    if (!data.email.endsWith('@mediatek.com')) {
        return { success: false, message: '僅限 mediatek.com 電子郵件註冊' };
    }

    const adminClient = createAdminClient();

    const { data: userData, error } = await adminClient.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: {
            name: data.name,
            employee_id: data.employee_id || null,
        },
    });

    if (error) {
        if (error.message.includes('already registered')) {
            return { success: false, message: '此電子郵件已被註冊' };
        }
        return { success: false, message: error.message };
    }

    // The DB trigger handle_new_user() auto-creates the profile row.
    // Update employee_id if the trigger didn't set it.
    if (userData.user && data.employee_id) {
        await adminClient
            .from('profiles')
            .update({ employee_id: data.employee_id })
            .eq('id', userData.user.id);
    }

    return { success: true, message: '註冊成功' };
}

// ------------------------------------------------------------------
// Reset Password (admin only)
// ------------------------------------------------------------------


/**
 * Admin: add cards to a member with a specific expiration date.
 * Creates a confirmed card_order and syncs balance.
 */
export async function adminAddCards(
    userId: string,
    quantity: number,
    expiresAt: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') return { success: false, message: '只有幹部可以新增堂卡' };

    if (quantity <= 0) return { success: false, message: '數量必須大於 0' };
    if (!expiresAt) return { success: false, message: '請指定到期日' };

    const adminClient = createAdminClient();

    // Create a confirmed card_order (admin grant)
    const { error: orderError } = await adminClient
        .from('card_orders')
        .insert({
            user_id: userId,
            quantity,
            used: 0,
            unit_price: 0,
            total_amount: 0,
            status: 'confirmed',
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString(),
            expires_at: expiresAt,
            include_membership: false,
        });

    if (orderError) return { success: false, message: `新增堂卡失敗: ${orderError.message}` };

    // Sync balance
    const { syncCardBalance } = await import('./card-utils');
    const newBalance = await syncCardBalance(userId);

    // Record transaction
    await adminClient.from('card_transactions').insert({
        user_id: userId,
        type: 'admin_add',
        amount: quantity,
        balance_after: newBalance,
        note: `幹部手動新增 ${quantity} 堂卡（到期日: ${expiresAt}）`,
        created_by: user.id,
    });

    revalidatePath('/', 'layout');
    return { success: true, message: `已新增 ${quantity} 堂卡，到期日 ${expiresAt}` };
}

export async function resetMemberPassword(
    userId: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以重置密碼');

    const adminClient = createAdminClient();
    const defaultPassword = 'mediatek';

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
        password: defaultPassword,
    });

    if (error) return { success: false, message: `重置密碼失敗: ${error.message}` };

    return { success: true, message: '密碼已重置為預設密碼' };
}

export async function updateSystemConfig(
    entries: { key: string; value: string }[]
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以修改系統設定');

    for (const entry of entries) {
        const { error } = await supabase
            .from('system_config')
            .upsert({ key: entry.key, value: entry.value }, { onConflict: 'key' });
        if (error) throw new Error(`更新 ${entry.key} 失敗: ${error.message}`);
    }

    revalidatePath('/', 'layout');
    return { success: true, message: `已更新 ${entries.length} 項設定` };
}

// ------------------------------------------------------------------
// Card Order Actions
// ------------------------------------------------------------------

export async function createCardOrder(quantity: number, includeMembership: boolean = false): Promise<{ success: boolean; message: string; orderId?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Check purchase window is open
    const config = await getSystemConfig();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Check master toggle
    if (config['card_purchase_open'] !== 'true') {
        throw new Error('堂卡購買時段尚未開放');
    }

    // Check date window
    const startDate = config['card_purchase_start'];
    if (startDate && startDate.trim() !== '' && todayStr < startDate) {
        throw new Error(`購卡時段尚未開始 (預計開放日期: ${startDate})`);
    }

    const endDate = config['card_purchase_end'];
    if (endDate && endDate.trim() !== '' && todayStr > endDate) {
        throw new Error(`購卡時段已結束 (截止日期: ${endDate})`);
    }

    const minPurchase = parseInt(config['card_min_purchase'] ?? '5', 10);
    if (quantity < minPurchase) {
        throw new Error(`最小購買數量為 ${minPurchase} 堂`);
    }

    // Get user profile to determine price
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, member_group_id, member_groups ( valid_until )')
        .eq('id', user.id)
        .maybeSingle();

    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const groupValidUntil = (profile?.member_groups as any)?.valid_until;
    const isMember = profile?.role !== 'guest' &&
        (!groupValidUntil || groupValidUntil >= today);
    const unitPrice = (isMember || includeMembership)
        ? parseInt(config['card_price_member'] ?? '270', 10)
        : parseInt(config['card_price_non_member'] ?? '370', 10);

    // Card expiry: end of current year by default
    const expireMonth = parseInt(config['card_expire_month'] ?? '12', 10);
    const expiresAt = new Date(new Date().getFullYear(), expireMonth, 0); // last day of expire month

    const membershipPrice = includeMembership ? 1800 : 0;
    const totalAmount = (quantity * unitPrice) + membershipPrice;

    const { data, error } = await supabase
        .from('card_orders')
        .insert({
            user_id: user.id,
            quantity,
            unit_price: unitPrice,
            total_amount: totalAmount,
            status: 'pending',
            include_membership: includeMembership,
            expires_at: expiresAt.toISOString().split('T')[0],
        })
        .select('id')
        .single();

    if (error) throw new Error(`訂單建立失敗: ${error.message}`);

    return { success: true, message: '訂單已建立', orderId: data.id };
}

export async function createCardOrderWithRemittance(
    quantity: number,
    includeMembership: boolean,
    bankCode: string,
    last5: string,
    remittanceDate: string,
    note?: string
) {
    const res = await createCardOrder(quantity, includeMembership);
    if (!res.success || !res.orderId) return res;

    const res2 = await submitRemittanceInfo(res.orderId, bankCode, last5, remittanceDate, note);
    return res2;
}

export async function submitRemittanceInfo(
    orderId: string,
    bankCode: string,
    last5: string,
    remittanceDate: string,
    note?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { error } = await supabase
        .from('card_orders')
        .update({
            status: 'remitted',
            remittance_bank_code: bankCode,
            remittance_account_last5: last5,
            remittance_date: remittanceDate,
            remittance_note: note ?? null,
        })
        .eq('id', orderId)
        .eq('user_id', user.id)
        .eq('status', 'pending'); // only allow if still pending

    if (error) throw new Error(`填寫匯款資訊失敗: ${error.message}`);

    return { success: true, message: '匯款資訊已送出，等待財務確認' };
}

export async function cancelCardOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: order } = await supabase
        .from('card_orders')
        .select('*')
        .eq('id', orderId)
        .eq('user_id', user.id)
        .single();

    if (!order) return { success: false, message: '找不到訂單' };
    if (order.status !== 'pending' && order.status !== 'remitted') {
        return { success: false, message: '此收費狀態已無法取消' };
    }

    const { error } = await supabase
        .from('card_orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);

    if (error) return { success: false, message: '取消失敗' };
    return { success: true, message: '訂單已取消' };
}

/** Admin: confirm card order and issue cards to user */
export async function confirmCardOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: order } = await supabase
        .from('card_orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    if (!order) throw new Error('訂單不存在');
    if (order.status === 'confirmed') return { success: false, message: '訂單已確認' };

    // Update order status
    const { error: orderError } = await supabase
        .from('card_orders')
        .update({
            status: 'confirmed',
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString(),
        })
        .eq('id', orderId);

    if (orderError) throw new Error(`確認訂單失敗: ${orderError.message}`);

    // Sync balance from pools (respects expiry)
    const { syncCardBalance } = await import('./card-utils');
    const newBalance = await syncCardBalance(order.user_id);

    // If membership included, upgrade user to member and assign to latest group
    if (order.include_membership) {
        const { data: upProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', order.user_id)
            .single();

        // Get latest member group
        const { data: latestGroup } = await supabase
            .from('member_groups')
            .select('id')
            .order('valid_until', { ascending: false })
            .limit(1)
            .maybeSingle();

        const updateData: any = { member_group_id: latestGroup?.id || null };
        if (upProfile?.role === 'guest') {
            updateData.role = 'member';
        }

        await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', order.user_id);
    }

    // Record transaction
    await supabase.from('card_transactions').insert({
        user_id: order.user_id,
        type: 'purchase',
        amount: order.quantity,
        balance_after: newBalance,
        order_id: orderId,
        note: `購買 ${order.quantity} 堂卡${order.include_membership ? '（含加入社員）' : ''}（訂單 ${orderId.slice(0, 8)}）`,
        created_by: user.id,
    });

    return { success: true, message: `已核發 ${order.quantity} 堂卡給使用者` };
}

/** Admin: reject card order */
export async function rejectCardOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // 1. Get order and current status
    const { data: order } = await supabase.from('card_orders').select('*').eq('id', orderId).maybeSingle();
    if (!order) throw new Error('訂單不存在');

    // 2. Update status to rejected (this removes it from the pool since status != 'confirmed')
    // 3. Then sync balance to reflect the change
    const { error } = await supabase
        .from('card_orders')
        .update({
            status: 'rejected',
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString(),
        })
        .eq('id', orderId);

    if (error) return { success: false, message: '駁回失敗' };

    // Sync balance from pools (rejected orders are excluded)
    const { syncCardBalance } = await import('./card-utils');
    await syncCardBalance(order.user_id);

    return { success: true, message: '訂單已駁回' };
}
