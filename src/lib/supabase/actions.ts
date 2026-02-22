'use server';

/**
 * Server Actions — all mutations go through here
 * These run on the server, so they can use service-role or just createClient()
 */

import { revalidatePath } from 'next/cache';
import { createClient } from './server';
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
    if (course.status !== 'published') throw new Error('課程尚未開放報名');

    const now = new Date();
    if (course.enrollment_start_at && new Date(course.enrollment_start_at) > now) {
        throw new Error('報名尚未開始');
    }
    if (course.enrollment_end_at && new Date(course.enrollment_end_at) < now) {
        throw new Error('報名已截止');
    }

    // 3. Calculate cards to deduct
    let cardsToDeduct = 0;
    const sessionsCount = (course.course_sessions as any)?.[0]?.count ?? 0;

    if (type === 'full') {
        cardsToDeduct = course.cards_per_session * sessionsCount;
    } else {
        cardsToDeduct = course.cards_per_session;
    }

    if (profile.card_balance < cardsToDeduct) {
        return {
            success: false,
            status: 'enrolled', // meaningless here but satisfying type
            message: `堂卡餘額不足 (餘額: ${profile.card_balance}, 需扣除: ${cardsToDeduct})`,
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
        });

        if (error) throw new Error(`加入候補失敗: ${error.message}`);

        revalidatePath('/', 'layout');
        return { success: true, status: 'waitlist', message: '已加入候補名單 (候補期間不扣卡)' };
    }

    // 5. Enroll directly and deduct cards
    const newBalance = profile.card_balance - cardsToDeduct;

    // Use a transaction-like approach (Supabase doesn't have cross-table transactions in client SDK easily without RPC, 
    // but we can do sequential updates and hope for the best, or better: use an RPC for atomic deduction)
    // For MVP, we'll do sequential.
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
    }).select('id').single();

    if (enrollError) throw new Error(`報名失敗: ${enrollError.message}`);

    // Update profile balance
    await supabase.from('profiles').update({ card_balance: newBalance }).eq('id', user.id);

    // Record transaction
    await supabase.from('card_transactions').insert({
        user_id: user.id,
        type: 'deduct',
        amount: -cardsToDeduct,
        balance_after: newBalance,
        enrollment_id: enrollment.id,
        note: `${type === 'full' ? '整期' : '單堂'}報名課程: ${course.name}`,
    });

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

    const enrolledIds = new Set((existing ?? []).map(e => e.course_id));
    const toEnroll = courses.filter(c => !enrolledIds.has(c.id) && c.status === 'published');

    if (toEnroll.length === 0) return { success: false, message: '所選課程皆已報名或不開放報名' };

    // 3. Calculate total cost
    let totalCost = 0;
    for (const course of toEnroll) {
        const sessionsCount = (course.course_sessions as any)?.[0]?.count ?? 0;
        totalCost += course.cards_per_session * sessionsCount;
    }

    if (profile.card_balance < totalCost) {
        return { success: false, message: `堂卡餘額不足 (餘額: ${profile.card_balance}, 需扣除: ${totalCost})` };
    }

    // 4. Perform enrollments (Sequential updates since batching across tables is hard without logic)
    // We'll mark the balance update first (atomic deduction would be better via RPC)
    const newBalance = profile.card_balance - totalCost;

    // Update balance
    await supabase.from('profiles').update({ card_balance: newBalance }).eq('id', user.id);

    // Create enrollments
    const enrollments = toEnroll.map(c => ({
        course_id: c.id,
        user_id: user.id,
        status: 'enrolled',
        type: 'full' as const,
        source: 'self' as const,
    }));

    const { data: inserted, error: enrollError } = await supabase.from('enrollments').upsert(enrollments, { onConflict: 'course_id,user_id' }).select('id, course_id');
    if (enrollError) {
        // Rollback balance (not perfect but better than nothing)
        await supabase.from('profiles').update({ card_balance: profile.card_balance }).eq('id', user.id);
        throw new Error(`報名失敗: ${enrollError.message}`);
    }

    // Record transactions
    const transactions = toEnroll.map(c => {
        const enrollmentId = inserted.find(i => i.course_id === c.id)?.id;
        const sessionsCount = (c.course_sessions as any)?.[0]?.count ?? 0;
        const cost = c.cards_per_session * sessionsCount;
        return {
            user_id: user.id,
            type: 'deduct' as const,
            amount: -cost,
            balance_after: 0, // We'll just leave it or calculate per step
            enrollment_id: enrollmentId,
            note: `整期報名課程: ${c.name}`,
        };
    });

    // We'll insert transactions one by one or batch if possible, but balance_after is tricky in batch
    // For simplicity, we'll just insert and ignore balance_after or set to current newBalance for all (ledger style)
    await supabase.from('card_transactions').insert(transactions.map(t => ({ ...t, balance_after: newBalance })));

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

    // 3. Calculate total cost
    const totalCost = course.cards_per_session * toEnrollSessionIds.length;

    if (profile.card_balance < totalCost) {
        return { success: false, message: `堂卡餘額不足 (餘額: ${profile.card_balance}, 需扣除: ${totalCost})` };
    }

    // 4. Perform enrollments
    const newBalance = profile.card_balance - totalCost;

    // Update balance
    await supabase.from('profiles').update({ card_balance: newBalance }).eq('id', user.id);

    // Create enrollments
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

    if (enrollError) {
        await supabase.from('profiles').update({ card_balance: profile.card_balance }).eq('id', user.id);
        throw new Error(`報名失敗: ${enrollError.message}`);
    }

    // Record transactions
    const transactions = toEnrollSessionIds.map(sid => {
        const enrollmentId = inserted.find(i => i.session_id === sid)?.id;
        return {
            user_id: user.id,
            type: 'deduct' as const,
            amount: -course.cards_per_session,
            balance_after: newBalance,
            enrollment_id: enrollmentId,
            note: `單堂報名課程: ${course.name} (堂次: ${sid})`,
        };
    });

    await supabase.from('card_transactions').insert(transactions);

    revalidatePath('/', 'layout');
    return { success: true, message: `成功報名 ${toEnrollSessionIds.length} 堂課，扣除 ${totalCost} 堂卡。` };
}

/**
 * Cancel current user's enrollment in a course.
 * Promotes first waitlist person if applicable.
 */
export async function cancelEnrollment(courseId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, status')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .maybeSingle();

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

    if (profile?.role !== 'admin') throw new Error('只有管理員可以指派班長');

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

    // Update the target user's role to 'leader' if they're a member
    await supabase
        .from('profiles')
        .update({ role: 'leader' })
        .eq('id', targetUserId)
        .eq('role', 'member');

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

    if (profile?.role !== 'admin') throw new Error('只有管理員可以移除班長');

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

export async function createCourseGroup(title: string): Promise<{ success: boolean; message: string; id?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Verify current user is admin
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有管理員可以建立課程檔期');

    const { data, error } = await supabase
        .from('course_groups')
        .insert({ title, created_by: user.id })
        .select()
        .single();

    if (error) throw new Error(`建立檔期失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: '成功建立課程檔期', id: data.id };
}

export async function updateCourseGroup(id: string, title: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Verify current user is admin
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有管理員可以修改課程檔期');

    const { error } = await supabase
        .from('course_groups')
        .update({ title })
        .eq('id', id);

    if (error) throw new Error(`修正檔期失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: '成功修正課程檔期標題' };
}

export async function createCourse(data: any): Promise<{ success: boolean; message: string; id?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Admin check
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有管理員可以建立課程');

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
            status: data.status,
            created_by: user.id
        })
        .select()
        .single();

    if (courseError) throw new Error(`建立課程失敗: ${courseError.message}`);

    // 2. Insert Sessions
    const sessions = data.sessions.map((s: any, index: number) => ({
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
    if (profile?.role !== 'admin') throw new Error('只有管理員可以更新課程');

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
            status: data.status,
        })
        .eq('id', id);

    if (courseError) throw new Error(`更新課程失敗: ${courseError.message}`);

    // 2. Sync Sessions
    const nextSessions = data.sessions.map((s: any, index: number) => {
        let dateStr = s.date;
        if (s.date instanceof Date) {
            // Local date ISO string: YYYY-MM-DD
            const y = s.date.getFullYear();
            const m = String(s.date.getMonth() + 1).padStart(2, '0');
            const d = String(s.date.getDate()).padStart(2, '0');
            dateStr = `${y}-${m}-${d}`;
        } else if (typeof s.date === 'string' && s.date.includes('T')) {
            dateStr = s.date.split('T')[0];
        }

        return {
            id: s.id,
            course_id: id,
            session_date: dateStr,
            session_number: index + 1
        };
    });

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
            throw new Error('無法刪除已有紀錄的課堂。此堂課已有學員點名、請假或轉讓紀錄，如需異動請洽系統管理員。');
        }

        // Check Requests (Leave, Makeup, Transfer)
        const [leaveRes, makeupRes, transferRes] = await Promise.all([
            supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('session_id', idsToRemove),
            supabase.from('makeup_requests').select('id', { count: 'exact', head: true }).or(`original_session_id.in.(${idsToRemove.join(',')}),target_session_id.in.(${idsToRemove.join(',')})`),
            supabase.from('transfer_requests').select('id', { count: 'exact', head: true }).in('session_id', idsToRemove)
        ]);

        if ((leaveRes.count || 0) > 0 || (makeupRes.count || 0) > 0 || (transferRes.count || 0) > 0) {
            throw new Error('無法刪除已有紀錄的課堂。此堂課已有學員點名、請假或轉讓紀錄，如需異動請洽系統管理員。');
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

    // Check user is enrolled in FULL TERM (new rule: single-session doesn't allow leave)
    const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, type')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .eq('status', 'enrolled')
        .maybeSingle();

    if (!enrollment) throw new Error('您未報名此課程，無法申請請假');
    if (enrollment.type !== 'full') throw new Error('單堂報名不支援請假申請');

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

    if (currentAttendance?.status && currentAttendance.status !== 'unmarked' && currentAttendance.status !== 'present' && currentAttendance.status !== 'absent') {
        throw new Error('此堂課已有特殊出席狀態（如轉讓/補課），無法申請請假');
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
        supabase.from('makeup_requests').delete().eq('original_session_id', sessionId).eq('user_id', user.id)
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
            supabase.from('makeup_requests').delete().eq('original_session_id', req.session_id).eq('user_id', req.user_id)
        ]);
    } else {
        // If rejected, remove the attendance record ONLY IF it is currently 'leave'
        await supabase
            .from('attendance_records')
            .delete()
            .eq('session_id', req.session_id)
            .eq('user_id', req.user_id)
            .eq('status', 'leave');
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准請假' : '已駁回請假' };
}

// ------------------------------------------------------------------
// Makeup Request Actions
// ------------------------------------------------------------------

export async function submitMakeupRequest(
    originalCourseId: string,
    originalSessionId: string,
    targetCourseId: string,
    targetSessionId: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Check user and original/target courses
    const [originalCourseRes, targetRes, userEnrollmentRes] = await Promise.all([
        supabase.from('courses').select('group_id, type').eq('id', originalCourseId).maybeSingle(),
        supabase.from('course_sessions').select('course_id, courses ( group_id, capacity )').eq('id', targetSessionId).maybeSingle(),
        supabase.from('enrollments').select('type').eq('course_id', originalCourseId).eq('user_id', user.id).eq('status', 'enrolled').maybeSingle(),
    ]);

    const originalCourse = originalCourseRes.data;
    const target = targetRes.data;
    const userEnrollment = userEnrollmentRes.data;

    if (!target) throw new Error('目標堂次不存在');
    if (!originalCourse) throw new Error('原始課程不存在');
    if (!userEnrollment) throw new Error('您未報名原始課程');

    // Rule 0: Cannot makeup in a course you are already enrolled in
    const { data: targetEnrollment } = await supabase
        .from('enrollments')
        .select('id')
        .eq('course_id', targetCourseId)
        .eq('user_id', user.id)
        .eq('status', 'enrolled')
        .maybeSingle();

    if (targetEnrollment) throw new Error('您已報名目標課程，無需申請補課');

    // Rule 1: No cross-period makeup
    const targetGroup = (target.courses as any)?.group_id;
    if (originalCourse.group_id !== targetGroup) {
        throw new Error('不支援跨期補課，請選擇相同檔期的課程');
    }

    // Rule 2: Only full-term enrollees can makeup
    if (userEnrollment.type !== 'full') {
        throw new Error('單堂報名學員不支援補課申請');
    }

    // --- Quota Calculation (Only for 'normal' courses) ---
    if (originalCourse.type === 'normal') {
        const { count: sessionsCount } = await supabase
            .from('course_sessions')
            .select('*', { count: 'exact', head: true })
            .eq('course_id', originalCourseId);

        const totalQuota = computeMakeupQuota(sessionsCount ?? 8);

        // Check used quota (makeup + transfers combined)
        const usedMakeup = await getUserMakeupQuotaUsed(user.id, originalCourseId);
        const usedTransfer = await getUserTransferCount(user.id, originalCourseId);
        const totalUsed = usedMakeup + usedTransfer;

        if (totalUsed >= totalQuota) {
            return {
                success: false,
                message: `補課/轉讓額度已用完（${totalUsed}/${totalQuota}）`,
            };
        }
    }

    // Rule 3: Target session capacity check
    const { count: enrolledInTarget } = await supabase
        .from('attendance_records')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', targetSessionId)
        .in('status', ['present', 'makeup', 'transfer_in']);

    // Also count official students who haven't marked yet (they own the slot)
    const { count: officialEnrolled } = await supabase
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', targetCourseId)
        .eq('status', 'enrolled');

    if ((officialEnrolled ?? 0) >= (target.courses as any).capacity) {
        // Technically we should check if someone in target has applied for leave
        const { count: leaveApproved } = await supabase
            .from('attendance_records')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', targetSessionId)
            .eq('status', 'leave');

        const effectiveOccupied = (officialEnrolled ?? 0) - (leaveApproved ?? 0) + (enrolledInTarget ?? 0);
        if (effectiveOccupied >= (target.courses as any).capacity) {
            throw new Error('目標堂次已滿人，無法補課');
        }
    }

    // --- Duplicate Guard ---
    // Guard: Prevent duplicate makeup for same target session. Reuse if exists.
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

    // Determine cross-zone quota cost
    let quotaUsed = 1;

    const payload = {
        original_course_id: originalCourseId,
        original_session_id: originalSessionId,
        target_course_id: targetCourseId,
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

    // --- NEW: Cross-Intent Cleanup ---
    // Student is now using this slot for Makeup, remove any existing Leave or Transfer intents for the ORIGINAL session
    await Promise.all([
        supabase.from('leave_requests').delete().eq('session_id', originalSessionId).eq('user_id', user.id),
        supabase.from('transfer_requests').delete().eq('session_id', originalSessionId).eq('from_user_id', user.id)
    ]);

    // Update attendance record immediately
    await supabase.from('attendance_records').upsert({
        session_id: targetSessionId,
        user_id: user.id,
        status: 'makeup',
        marked_by: user.id,
        marked_at: new Date().toISOString(),
    }, { onConflict: 'session_id,user_id' });

    revalidatePath('/', 'layout');
    return { success: true, message: `補課成功！已扣除 ${quotaUsed} 額度，並更新目標堂次名單。` };
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
    courseId: string
): Promise<{
    waitlist: { id: string; name: string; role: string; position: number }[];
    allMembers: { id: string; name: string; role: string }[];
}> {
    const { supabase, user } = await getCurrentUser();

    // 1. Get waitlisted users for this course (ordered by position)
    const { data: waitlistData } = await supabase
        .from('enrollments')
        .select('waitlist_position, profiles ( id, name, role )')
        .eq('course_id', courseId)
        .eq('status', 'waitlist')
        .order('waitlist_position');

    const waitlist = (waitlistData ?? []).map((w: any) => ({
        id: w.profiles?.id ?? '',
        name: w.profiles?.name ?? '未知',
        role: w.profiles?.role ?? 'guest',
        position: w.waitlist_position ?? 0,
    })).filter((w: any) => w.id && w.id !== user.id);

    // 2. Get all active members (exclude self)
    const { data: membersData } = await supabase
        .from('profiles')
        .select('id, name, role')
        .neq('id', user.id)
        .order('name');

    const allMembers = (membersData ?? []).map((m: any) => ({
        id: m.id,
        name: m.name ?? '未知',
        role: m.role ?? 'guest',
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
    const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id, type')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .eq('status', 'enrolled')
        .maybeSingle();

    if (!enrollment) throw new Error('您未報名此課程');
    if (enrollment.type !== 'full') throw new Error('單堂報名不支援轉讓申請');

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
    // --- Quota Calculation (Only for 'normal' courses) ---
    const { data: courseMeta } = await supabase.from('courses').select('type').eq('id', courseId).maybeSingle();

    if (courseMeta?.type === 'normal') {
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

    // Compute extra cards if non-member receives member spot
    let extraCardsRequired = 0;
    if (toUserId) {
        const { data: toProfile } = await supabase
            .from('profiles')
            .select('role, member_valid_until')
            .eq('id', toUserId)
            .maybeSingle();

        const fromProfile = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();

        const fromIsMember = fromProfile.data?.role !== 'guest';
        const toIsMember = toProfile?.role !== 'guest' &&
            (!toProfile?.member_valid_until || new Date(toProfile.member_valid_until) >= new Date());

        if (fromIsMember && !toIsMember) {
            const config = await getSystemConfig();
            const diff = parseInt(config['card_price_non_member'] ?? '370') - parseInt(config['card_price_member'] ?? '270');
            extraCardsRequired = Math.ceil(diff / parseInt(config['card_price_non_member'] ?? '370'));
        }
    }

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
        supabase.from('makeup_requests').delete().eq('original_session_id', sessionId).eq('user_id', user.id)
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
            supabase.from('makeup_requests').delete().eq('original_session_id', req.session_id).eq('user_id', req.from_user_id)
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
// Member Profile Actions
// ------------------------------------------------------------------

export async function updateMemberProfile(
    userId: string,
    data: { role?: string; member_valid_until?: string | null }
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Admin check
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有管理員可以修改社員資料');

    const updateData: Record<string, any> = {};
    if (data.role !== undefined) updateData.role = data.role;
    if (data.member_valid_until !== undefined) updateData.member_valid_until = data.member_valid_until;

    if (Object.keys(updateData).length === 0) {
        return { success: false, message: '沒有要更新的欄位' };
    }

    const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId);

    if (error) throw new Error(`更新社員資料失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: '社員資料已更新' };
}

export async function updateSystemConfig(
    entries: { key: string; value: string }[]
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有管理員可以修改系統設定');

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

export async function createCardOrder(quantity: number): Promise<{ success: boolean; message: string; orderId?: string }> {
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
        .select('role, member_valid_until')
        .eq('id', user.id)
        .maybeSingle();

    const isMember = profile?.role !== 'guest' &&
        (!profile?.member_valid_until || new Date(profile.member_valid_until) >= new Date());
    const unitPrice = isMember
        ? parseInt(config['card_price_member'] ?? '270', 10)
        : parseInt(config['card_price_non_member'] ?? '370', 10);

    // Card expiry: end of current year by default
    const expireMonth = parseInt(config['card_expire_month'] ?? '12', 10);
    const expiresAt = new Date(new Date().getFullYear(), expireMonth, 0); // last day of expire month

    const { data, error } = await supabase
        .from('card_orders')
        .insert({
            user_id: user.id,
            quantity,
            unit_price: unitPrice,
            total_amount: quantity * unitPrice,
            status: 'pending',
            expires_at: expiresAt.toISOString().split('T')[0],
        })
        .select('id')
        .single();

    if (error) throw new Error(`訂單建立失敗: ${error.message}`);

    return { success: true, message: '訂單已建立，請掃描 QR Code 匯款', orderId: data.id };
}

export async function submitRemittanceInfo(
    orderId: string,
    last5: string,
    remittanceDate: string,
    note?: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { error } = await supabase
        .from('card_orders')
        .update({
            status: 'remitted',
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

    // Get current balance
    const { data: profile } = await supabase
        .from('profiles')
        .select('card_balance')
        .eq('id', order.user_id)
        .maybeSingle();

    const currentBalance = profile?.card_balance ?? 0;
    const newBalance = currentBalance + order.quantity;

    // Update card_balance on profile
    await supabase
        .from('profiles')
        .update({ card_balance: newBalance })
        .eq('id', order.user_id);

    // Record transaction
    await supabase.from('card_transactions').insert({
        user_id: order.user_id,
        type: 'purchase',
        amount: order.quantity,
        balance_after: newBalance,
        order_id: orderId,
        note: `購買 ${order.quantity} 堂卡（訂單 ${orderId.slice(0, 8)}）`,
        created_by: user.id,
    });

    return { success: true, message: `已核發 ${order.quantity} 堂卡給使用者` };
}
