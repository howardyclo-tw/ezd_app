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
 */
export async function enrollInCourse(courseId: string): Promise<{ success: boolean; status: 'enrolled' | 'waitlist'; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // 1. Check if already enrolled
    const { data: existing } = await supabase
        .from('enrollments')
        .select('id, status')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (existing && existing.status !== 'cancelled') {
        return { success: false, status: existing.status as any, message: '您已報名此課程' };
    }

    // 2. Get course info (capacity + current enrollment count)
    const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('id, capacity, status, enrollment_start_at, enrollment_end_at, cards_per_session')
        .eq('id', courseId)
        .maybeSingle();

    if (courseError || !course) throw new Error('課程不存在');
    if (course.status !== 'published') throw new Error('課程尚未開放報名');

    const now = new Date();
    if (course.enrollment_start_at && new Date(course.enrollment_start_at) > now) {
        throw new Error('報名尚未開始');
    }
    if (course.enrollment_end_at && new Date(course.enrollment_end_at) < now) {
        throw new Error('報名已截止');
    }

    // 3. Check current enrollment count
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

        if (existing) {
            // Update existing cancelled record
            const { error } = await supabase.from('enrollments').update({
                status: 'waitlist',
                waitlist_position,
                source: 'self',
                enrolled_at: new Date().toISOString(),
                cancelled_at: null,
            }).eq('id', existing.id);
            if (error) throw new Error(`加入候補失敗: ${error.message}`);
        } else {
            const { error } = await supabase.from('enrollments').insert({
                course_id: courseId,
                user_id: user.id,
                status: 'waitlist',
                waitlist_position,
                source: 'self',
            });
            if (error) throw new Error(`報名失敗: ${error.message}`);
        }

        revalidatePath('/', 'layout');
        return { success: true, status: 'waitlist', message: '已加入候補名單' };
    }

    // 4. Enroll directly
    if (existing) {
        // Update existing cancelled record
        const { error } = await supabase.from('enrollments').update({
            status: 'enrolled',
            waitlist_position: null,
            source: 'self',
            enrolled_at: new Date().toISOString(),
            cancelled_at: null,
        }).eq('id', existing.id);
        if (error) throw new Error(`報名失敗: ${error.message}`);
    } else {
        const { error } = await supabase.from('enrollments').insert({
            course_id: courseId,
            user_id: user.id,
            status: 'enrolled',
            source: 'self',
        });
        if (error) throw new Error(`報名失敗: ${error.message}`);
    }

    revalidatePath(`/`, `layout`);
    return { success: true, status: 'enrolled', message: '報名成功！' };
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

    // Upsert to handle re-assignment
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

    // Check user is enrolled
    const { data: enrollment } = await supabase
        .from('enrollments')
        .select('id')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .eq('status', 'enrolled')
        .maybeSingle();

    if (!enrollment) throw new Error('您未報名此課程，無法申請請假');

    // Check no duplicate
    const { data: existing } = await supabase
        .from('leave_requests')
        .select('id, status')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .maybeSingle();

    if (existing) {
        return { success: false, message: `已有請假申請（狀態：${existing.status}）` };
    }

    const { error } = await supabase.from('leave_requests').insert({
        course_id: courseId,
        session_id: sessionId,
        user_id: user.id,
        reason: reason ?? null,
        status: 'pending',
    });

    if (error) throw new Error(`請假申請失敗: ${error.message}`);

    revalidatePath(`/`, `layout`);
    return { success: true, message: '請假申請已送出，等待班長確認' };
}

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

    // If approved, update attendance record to 'leave'
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
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准請假' : '已拒絕請假' };
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

    // Get original course sessions count for quota calculation
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

    // Check target session has space
    const { data: target } = await supabase
        .from('course_sessions')
        .select('course_id, courses ( capacity )')
        .eq('id', targetSessionId)
        .maybeSingle();

    if (!target) throw new Error('目標堂次不存在');

    // Determine cross-zone quota cost
    // For MVP, same course type = 1, cross-type special↔normal = special rule
    let quotaUsed = 1;

    const { error } = await supabase.from('makeup_requests').insert({
        original_course_id: originalCourseId,
        original_session_id: originalSessionId,
        target_course_id: targetCourseId,
        target_session_id: targetSessionId,
        user_id: user.id,
        status: 'pending',
        quota_used: quotaUsed,
    });

    if (error) throw new Error(`補課申請失敗: ${error.message}`);

    revalidatePath('/', 'layout');
    return { success: true, message: `補課申請已送出（使用 ${quotaUsed} 額度，剩餘 ${totalQuota - totalUsed - quotaUsed}）` };
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

    // If approved, create attendance record on target session
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
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准補課' : '已拒絕補課' };
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

    // Check quota
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

    const { error } = await supabase.from('transfer_requests').insert({
        course_id: courseId,
        session_id: sessionId,
        from_user_id: user.id,
        to_user_id: toUserId,
        to_user_name: toUserName ?? null,
        extra_cards_required: extraCardsRequired,
        status: 'pending',
    });

    if (error) throw new Error(`轉讓申請失敗: ${error.message}`);

    revalidatePath(`/`, `layout`);
    return { success: true, message: '轉讓申請已送出，等待班長確認' };
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
    }

    revalidatePath('/', 'layout');
    return { success: true, message: decision === 'approved' ? '已核准轉讓' : '已拒絕轉讓' };
}

// ------------------------------------------------------------------
// Card Order Actions
// ------------------------------------------------------------------

export async function createCardOrder(quantity: number): Promise<{ success: boolean; message: string; orderId?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Check purchase window is open
    const config = await getSystemConfig();
    if (config['card_purchase_open'] !== 'true') {
        throw new Error('堂卡購買時段尚未開放');
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
