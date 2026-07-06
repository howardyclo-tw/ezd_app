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
import { isMemberActive, resolvePrice } from '@/lib/supabase/pricing';
import { getTaipeiToday } from '@/lib/date';
import { isCardWindowOpen, getCardPurchaseWindow } from '@/lib/card-window';
import { validatePurchaseQuantity } from '@/lib/card-purchase';


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
// Enrollment guard helpers (pricing mode, enroll mode, time windows)
// ------------------------------------------------------------------

/** Reject courses whose pricing_mode !== 'card' (ntd/free use a different path). */
function guardPricingMode(course: { pricing_mode?: string; name?: string }): string | null {
    if (course.pricing_mode && course.pricing_mode !== 'card') {
        return '此課程不適用堂卡報名';
    }
    return null;
}

/** Reject full enrollment if the course has enroll_full disabled. */
function guardEnrollFull(course: { enroll_full?: boolean }): string | null {
    if (course.enroll_full === false) {
        return '此課程未開放整期報名';
    }
    return null;
}

/** Reject single enrollment if the course has enroll_single disabled. */
function guardEnrollSingle(course: { enroll_single?: boolean }): string | null {
    if (course.enroll_single === false) {
        return '此課程未開放單堂報名';
    }
    return null;
}

/** Reject full enrollment if the course is member-only and the user is not an active member. */
function guardEnrollFullIdentity(course: { enroll_full_identity?: string }, isMember: boolean): string | null {
    if (course.enroll_full_identity === 'member' && !isMember) {
        return '此課程整期報名僅開放社員';
    }
    return null;
}

/** Reject single enrollment if the course is member-only and the user is not an active member. */
function guardEnrollSingleIdentity(course: { enroll_single_identity?: string }, isMember: boolean): string | null {
    if (course.enroll_single_identity === 'member' && !isMember) {
        return '此課程單堂報名僅開放社員';
    }
    return null;
}

/**
 * Check course-group phase1 window for full enrollment.
 * Fetches the course_groups row via group_id on the course.
 * Returns a rejection message string or null if within window.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function guardGroupPhase1Window(
    supabase: any,
    courseGroupId: string | null
): Promise<string | null> {
    if (!courseGroupId) return null; // no group => no group window to check
    const { data: group } = await supabase.from('course_groups')
        .select('registration_phase1_start, registration_phase1_end')
        .eq('id', courseGroupId)
        .maybeSingle();
    if (!group) return null; // group not found => skip check (shouldn't happen)
    const now = new Date();
    if (group.registration_phase1_start && new Date(group.registration_phase1_start) > now) {
        return '整期報名尚未開始';
    }
    if (group.registration_phase1_end && new Date(group.registration_phase1_end) < now) {
        return '整期報名已截止';
    }
    return null;
}

/** Check course-level enrollment window for single enrollment. */
function guardCourseWindow(
    course: { enrollment_start_at?: string | null; enrollment_end_at?: string | null }
): string | null {
    const now = new Date();
    if (course.enrollment_start_at && new Date(course.enrollment_start_at) > now) {
        return '單堂報名尚未開始';
    }
    if (course.enrollment_end_at && new Date(course.enrollment_end_at) < now) {
        return '單堂報名已截止';
    }
    return null;
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

    // 2. Get course info and profile balance (expanded for identity check)
    const [courseRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*, course_sessions(count)').eq('id', courseId).maybeSingle(),
        supabase.from('profiles').select('card_balance, role, member_valid_until, member_group_id, member_groups ( valid_until )').eq('id', user.id).maybeSingle(),
    ]);

    const course = courseRes.data;
    const profile = profileRes.data;

    if (!course) throw new Error('課程不存在');
    if (!profile) throw new Error('使用者資料不存在');

    // Compute member status for identity guards
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacyGroupValidUntil = (profile.member_groups as any)?.valid_until ?? null;
    const legacyMemberActive = isMemberActive(
        { role: profile.role as any, member_valid_until: profile.member_valid_until ?? null, groupValidUntil: legacyGroupValidUntil },
        getTaipeiToday()
    );

    // ── Guards: pricing mode, enroll mode, identity, time windows ──
    const pricingMsg = guardPricingMode(course);
    if (pricingMsg) return { success: false, status: 'enrolled', message: pricingMsg };

    if (type === 'full') {
        const modeMsg = guardEnrollFull(course);
        if (modeMsg) return { success: false, status: 'enrolled', message: modeMsg };

        const fullIdentMsg = guardEnrollFullIdentity(course, legacyMemberActive);
        if (fullIdentMsg) return { success: false, status: 'enrolled', message: fullIdentMsg };

        const windowMsg = await guardGroupPhase1Window(supabase, course.group_id);
        if (windowMsg) return { success: false, status: 'enrolled', message: windowMsg };
    } else {
        const modeMsg = guardEnrollSingle(course);
        if (modeMsg) return { success: false, status: 'enrolled', message: modeMsg };

        const singleIdentMsg = guardEnrollSingleIdentity(course, legacyMemberActive);
        if (singleIdentMsg) return { success: false, status: 'enrolled', message: singleIdentMsg };

        const windowMsg = guardCourseWindow(course);
        if (windowMsg) return { success: false, status: 'enrolled', message: windowMsg };
    }

    // Legacy course-level window check (kept for full path as additional defence)
    if (type === 'full') {
        const now = new Date();
        if (course.enrollment_start_at && new Date(course.enrollment_start_at) > now) {
            throw new Error('報名尚未開始');
        }
        if (course.enrollment_end_at && new Date(course.enrollment_end_at) < now) {
            throw new Error('報名已截止');
        }
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
        const expiredHint = cardInfo.expired > 0 ? `，其中 ${cardInfo.expired} 張已過期無法使用` : '';
        return {
            success: false,
            status: 'enrolled',
            message: `堂卡餘額不足（可用: ${cardInfo.available}, 需扣除: ${cardsToDeduct}${expiredHint}）`,
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

    // 1. Get courses and sessions count + profile (expanded for identity check)
    const [coursesRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*, course_sessions(count)').in('id', courseIds),
        supabase.from('profiles').select('card_balance, role, member_valid_until, member_group_id, member_groups ( valid_until )').eq('id', user.id).maybeSingle(),
    ]);

    const courses = coursesRes.data ?? [];
    const profile = profileRes.data;

    if (!profile) throw new Error('使用者資料不存在');

    // Compute member status for identity guards
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupValidUntil = (profile.member_groups as any)?.valid_until ?? null;
    const taipeiToday = getTaipeiToday();
    const memberActive = isMemberActive(
        { role: profile.role as any, member_valid_until: profile.member_valid_until ?? null, groupValidUntil },
        taipeiToday
    );

    // ── Guards: pricing mode, enroll mode, identity ──
    // Filter out non-card courses, courses with enroll_full disabled, and identity-restricted courses
    const pricingRejected = courses.filter(c => guardPricingMode(c) !== null);
    const modeRejected = courses.filter(c => guardEnrollFull(c) !== null);
    const identityRejected = courses.filter(c => guardPricingMode(c) === null && guardEnrollFull(c) === null && guardEnrollFullIdentity(c, memberActive) !== null);
    const guardedCourses = courses.filter(c => guardPricingMode(c) === null && guardEnrollFull(c) === null && guardEnrollFullIdentity(c, memberActive) === null);

    if (guardedCourses.length === 0) {
        if (pricingRejected.length > 0) return { success: false, message: '此課程不適用堂卡報名' };
        if (modeRejected.length > 0) return { success: false, message: '此課程未開放整期報名' };
        if (identityRejected.length > 0) return { success: false, message: '此課程整期報名僅開放社員' };
        return { success: false, message: '所選課程皆已報名或不開放報名' };
    }

    // ── Guard: group phase1 window ──
    // Collect unique group_ids and check their windows
    const groupIds = [...new Set(guardedCourses.map(c => c.group_id).filter(Boolean))];
    const closedGroupIds = new Set<string>();
    const notStartedGroupIds = new Set<string>();
    for (const gid of groupIds) {
        const windowMsg = await guardGroupPhase1Window(supabase, gid);
        if (windowMsg === '整期報名已截止') closedGroupIds.add(gid);
        if (windowMsg === '整期報名尚未開始') notStartedGroupIds.add(gid);
    }
    const windowPassCourses = guardedCourses.filter(c =>
        !closedGroupIds.has(c.group_id) && !notStartedGroupIds.has(c.group_id)
    );
    if (windowPassCourses.length === 0) {
        if (closedGroupIds.size > 0) return { success: false, message: '整期報名已截止' };
        return { success: false, message: '整期報名尚未開始' };
    }

    // 2. Check each course status and already enrolled
    // For MVP/simplicity, we'll filter out already enrolled ones
    const { data: existing } = await supabase.from('enrollments')
        .select('course_id')
        .eq('user_id', user.id)
        .eq('type', 'full')
        .eq('status', 'enrolled');

    const now = new Date();
    const enrolledIds = new Set((existing ?? []).map(e => e.course_id));
    const toEnroll = windowPassCourses.filter(c => {
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
        const expiredHint = cardInfo.expired > 0 ? `，其中 ${cardInfo.expired} 張已過期無法使用` : '';
        return { success: false, message: `堂卡餘額不足（可用: ${cardInfo.available}, 需扣除: ${totalCost}${expiredHint}）` };
    }

    // 4. Enroll via atomic RPC (capacity check + insert + card deduction in single txn)
    const adminClient = createAdminClient();
    let enrolledCount = 0;
    let deductedTotal = 0;

    for (const course of toEnroll) {
        const sessionsCount = (course.course_sessions as any)?.[0]?.count ?? 0;
        const cost = course.cards_per_session * sessionsCount;

        const { data, error } = await adminClient.rpc('enroll_atomic', {
            p_user: user.id,
            p_course: course.id,
            p_type: 'full',
            p_session: null,
            p_status: 'enrolled',
            p_cards_to_deduct: cost,
            p_order_id: null,
        });

        if (error) throw new Error(`報名失敗: ${error.message}`);

        const result = data as { ok: boolean; enrollment_id?: string; reason?: string };
        if (!result.ok) {
            if (result.reason === 'already_enrolled') continue;
            if (result.reason === 'full') {
                if (enrolledCount > 0) {
                    revalidatePath('/', 'layout');
                    return { success: false, message: `已報名 ${enrolledCount} 門課程，但「${course.name}」已額滿。` };
                }
                return { success: false, message: `「${course.name}」已額滿` };
            }
            if (result.reason === 'insufficient_cards') {
                if (enrolledCount > 0) {
                    revalidatePath('/', 'layout');
                    return { success: false, message: `已完成 ${enrolledCount} 門課程報名，但堂卡不足，剩餘課程未完成。` };
                }
                return { success: false, message: '堂卡餘額不足' };
            }
            throw new Error(`報名失敗: ${result.reason}`);
        }
        enrolledCount++;
        deductedTotal += cost;
    }

    revalidatePath('/', 'layout');
    return { success: true, message: `成功報名 ${enrolledCount} 門課程，扣除 ${deductedTotal} 堂卡。` };
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

    // 1. Get course and profile (expanded for pricing identity)
    const [courseRes, profileRes] = await Promise.all([
        supabase.from('courses').select('*').eq('id', courseId).maybeSingle(),
        supabase.from('profiles').select('card_balance, role, member_valid_until, member_group_id, member_groups ( valid_until )').eq('id', user.id).maybeSingle(),
    ]);

    const course = courseRes.data;
    const profile = profileRes.data;

    if (!course) throw new Error('課程不存在');
    if (!profile) throw new Error('使用者資料不存在');

    // ── Guards: enroll mode, course window, identity ──
    // (guardPricingMode removed: pricing-aware routing handles all modes)
    const modeMsg = guardEnrollSingle(course);
    if (modeMsg) return { success: false, message: modeMsg };

    const windowMsg = guardCourseWindow(course);
    if (windowMsg) return { success: false, message: windowMsg };

    // Identity guard: check member-only single enrollment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const singleGroupValidUntil = (profile.member_groups as any)?.valid_until ?? null;
    const singleTaipeiToday = getTaipeiToday();
    const singleMemberActive = isMemberActive(
        { role: profile.role as any, member_valid_until: profile.member_valid_until ?? null, groupValidUntil: singleGroupValidUntil },
        singleTaipeiToday
    );
    const identMsg = guardEnrollSingleIdentity(course, singleMemberActive);
    if (identMsg) return { success: false, message: identMsg };

    // ── Route by pricing_mode ──
    const pricingMode = (course.pricing_mode ?? 'card') as string;

    if (pricingMode === 'card') {
        // ════════════════════════════════════════════════════════════
        // CARD PATH — existing behavior, kept verbatim for regression
        // ════════════════════════════════════════════════════════════

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

        // 3. Get each session's date for per-session FIFO pre-check
        const { data: sessionDateRows } = await supabase
            .from('course_sessions')
            .select('id, session_date')
            .in('id', toEnrollSessionIds)
            .order('session_date', { ascending: true });

        const sessionDateMap = new Map<string, string>();
        (sessionDateRows ?? []).forEach(s => sessionDateMap.set(s.id, s.session_date));

        // Simulate per-session FIFO to accurately check availability
        const { getAvailableCardBalance } = await import('./card-utils');
        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
        const cardInfo = await getAvailableCardBalance(user.id, today);
        // Copy pools for simulation
        const simPools = cardInfo.pools
            .filter(p => p.remaining > 0)
            .map(p => ({ ...p, simRemaining: p.remaining }));

        const sortedSessionIds = [...toEnrollSessionIds].sort((a, b) =>
            (sessionDateMap.get(a) ?? '').localeCompare(sessionDateMap.get(b) ?? ''));

        let canCover = 0;
        for (const sid of sortedSessionIds) {
            const sessionDate = sessionDateMap.get(sid)!;
            let need = course.cards_per_session;
            for (const pool of simPools) {
                if (pool.simRemaining <= 0) continue;
                if (pool.expires_at && pool.expires_at < sessionDate) continue;
                const take = Math.min(pool.simRemaining, need);
                pool.simRemaining -= take;
                need -= take;
                if (need <= 0) break;
            }
            if (need <= 0) canCover++;
        }

        if (canCover < toEnrollSessionIds.length) {
            const expiredTotal = simPools.reduce((sum, p) => {
                // Cards that still have remaining but are expired for at least one uncovered session
                if (p.simRemaining > 0 && p.expires_at && p.expires_at < (sessionDateMap.get(sortedSessionIds[sortedSessionIds.length - 1]) ?? '')) {
                    return sum + p.simRemaining;
                }
                return sum;
            }, 0);
            const expiredHint = expiredTotal > 0 ? `，有堂卡在部分堂次前到期無法使用` : '';
            return { success: false, message: `堂卡餘額不足（可報 ${canCover} 堂，需報 ${toEnrollSessionIds.length} 堂${expiredHint}）` };
        }

        // 4. Enroll via atomic RPC (capacity check + insert + card deduction in single txn)
        const adminClient = createAdminClient();
        let enrolledCount = 0;

        for (const sid of toEnrollSessionIds) {
            const { data, error } = await adminClient.rpc('enroll_atomic', {
                p_user: user.id,
                p_course: courseId,
                p_type: 'single',
                p_session: sid,
                p_status: 'enrolled',
                p_cards_to_deduct: course.cards_per_session,
                p_order_id: null,
            });

            if (error) throw new Error(`報名失敗: ${error.message}`);

            const result = data as { ok: boolean; enrollment_id?: string; reason?: string };
            if (!result.ok) {
                if (result.reason === 'full') {
                    throw new Error(`第 ${toEnrollSessionIds.indexOf(sid) + 1} 個選擇的堂次已額滿，請重新整理頁面。`);
                }
                if (result.reason === 'already_enrolled') continue;
                if (result.reason === 'insufficient_cards') {
                    if (enrolledCount > 0) {
                        revalidatePath('/', 'layout');
                        return { success: false, message: `已完成 ${enrolledCount} 堂報名，但堂卡不足，剩餘堂次未完成。` };
                    }
                    return { success: false, message: '堂卡餘額不足' };
                }
                throw new Error(`報名失敗: ${result.reason}`);
            }
            enrolledCount++;
        }

        revalidatePath('/', 'layout');
        return { success: true, message: `成功報名 ${enrolledCount} 堂課，扣除 ${enrolledCount * course.cards_per_session} 堂卡。` };
    }

    // ════════════════════════════════════════════════════════════════
    // NTD / FREE PATH — pricing-aware single enrollment
    // ════════════════════════════════════════════════════════════════

    // Resolve member identity for pricing
    const adminClient = createAdminClient();
    let groupValidUntil: string | null = null;
    if (profile.member_group_id) {
        const { data: memberGroup } = await adminClient.from('member_groups')
            .select('valid_until')
            .eq('id', profile.member_group_id)
            .maybeSingle();
        groupValidUntil = memberGroup?.valid_until ?? null;
    }

    const taipeiToday = getTaipeiToday();
    const memberActive = isMemberActive(
        { role: profile.role, member_valid_until: profile.member_valid_until ?? null, groupValidUntil },
        taipeiToday
    );

    // Check existing enrollments (include pending_payment for ntd)
    const { data: existing } = await supabase.from('enrollments')
        .select('session_id')
        .eq('course_id', courseId)
        .eq('user_id', user.id)
        .eq('type', 'single')
        .in('status', ['enrolled', 'pending_payment']);

    const enrolledSessionIds = new Set((existing ?? []).map(e => e.session_id));
    const toEnrollSessionIds = sessionIds.filter(id => !enrolledSessionIds.has(id));

    if (toEnrollSessionIds.length === 0) return { success: false, message: '所選堂次皆已報名' };

    // Compute session count for PricingInputs (resolvePrice ignores it for single mode, but required by type)
    const { data: allSessions } = await supabase
        .from('course_sessions')
        .select('id')
        .eq('course_id', courseId);
    const sessionCount = allSessions?.length ?? 0;

    const pricingInputs = {
        pricing_mode: pricingMode as import('@/types/database').PricingMode,
        cards_per_session: course.cards_per_session,
        price_member_single: course.price_member_single,
        price_guest_single: course.price_guest_single,
        price_member_full: course.price_member_full,
        price_guest_full: course.price_guest_full,
        sessionCount,
    };

    let priceResult: import('@/lib/supabase/pricing').PriceResult;
    try {
        priceResult = resolvePrice(pricingInputs, memberActive, 'single');
    } catch (e: unknown) {
        return { success: false, message: e instanceof Error ? e.message : '定價錯誤' };
    }

    // TODO (Phase 7): absence-penalty / blacklist guard for free courses.
    // If pricing_mode=free, check whether the user is blacklisted for chronic
    // no-shows and reject enrollment if so. Not implemented yet.

    const isFree = priceResult.kind === 'free';
    const enrollStatus = isFree ? 'enrolled' : 'pending_payment';
    let enrolledCount = 0;
    const ntdEnrollmentIds: string[] = [];
    let totalNtdAmount = 0;

    for (const sid of toEnrollSessionIds) {
        const { data, error } = await adminClient.rpc('enroll_atomic', {
            p_user: user.id,
            p_course: courseId,
            p_type: 'single',
            p_session: sid,
            p_status: enrollStatus,
            p_cards_to_deduct: 0,
            p_order_id: null,
        });

        if (error) throw new Error(`報名失敗: ${error.message}`);

        const result = data as { ok: boolean; enrollment_id?: string; reason?: string };
        if (!result.ok) {
            if (result.reason === 'full') {
                throw new Error(`第 ${toEnrollSessionIds.indexOf(sid) + 1} 個選擇的堂次已額滿，請重新整理頁面。`);
            }
            if (result.reason === 'already_enrolled') continue;
            throw new Error(`報名失敗: ${result.reason}`);
        }

        enrolledCount++;

        if (!isFree && priceResult.kind === 'ntd') {
            ntdEnrollmentIds.push(result.enrollment_id!);
            totalNtdAmount += priceResult.amount;
        }
    }

    if (enrolledCount === 0) return { success: false, message: '所選堂次皆已報名' };

    // Create course_fee order for NTD enrollments (server-resolved amount, client prices ignored)
    if (ntdEnrollmentIds.length > 0) {
        await createCourseFeeOrder({
            userId: user.id,
            courseGroupId: course.group_id,
            amount: totalNtdAmount,
            enrollmentIds: ntdEnrollmentIds,
        });

        revalidatePath('/', 'layout');
        return { success: true, message: `成功報名 ${enrolledCount} 堂課，請至訂單頁面繳費。` };
    }

    // Free enrollments completed
    revalidatePath('/', 'layout');
    return { success: true, message: `成功報名 ${enrolledCount} 堂課。` };
}

/**
 * Cancel current user's enrollment in a course.
 *
 * Server-enforced no-self-cancel rule:
 *   - ALLOWED: status=waitlist, or pending_payment whose linked order is NOT confirmed.
 *   - REJECTED: status=enrolled (regardless of card/ntd/free pricing),
 *               or pending_payment whose linked order IS confirmed.
 *
 * Promotes first waitlisted person when an occupying seat (pending_payment) is freed.
 */
export async function cancelEnrollment(courseId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: enrollments } = await supabase
        .from('enrollments')
        .select('id, status, order_id')
        .eq('course_id', courseId)
        .eq('user_id', user.id);

    const enrollment = enrollments?.find(e => e.status !== 'cancelled') || enrollments?.[0];

    if (!enrollment) return { success: false, message: '您未報名此課程' };

    // ── Server-enforced no-self-cancel for established enrollments ──
    if (enrollment.status === 'enrolled') {
        return { success: false, message: '已成立的報名無法自行取消，請洽幹部或改用請假。' };
    }

    if (enrollment.status === 'pending_payment' && enrollment.order_id) {
        // Check if the linked order is confirmed — block self-cancel if so
        const { data: order } = await supabase
            .from('orders')
            .select('status')
            .eq('id', enrollment.order_id)
            .maybeSingle();

        if (order?.status === 'confirmed') {
            return { success: false, message: '已確認的繳費單無法自行取消，請洽幹部。' };
        }

        // Block partial cancel: if order has other active enrollments, redirect to cancel order
        const adminClient = createAdminClient();
        const { data: siblings } = await adminClient
            .from('enrollments')
            .select('id')
            .eq('order_id', enrollment.order_id)
            .in('status', ['enrolled', 'pending_payment', 'pending_vote'])
            .neq('id', enrollment.id);

        if (siblings && siblings.length > 0) {
            return { success: false, message: '此報名屬於群組報名訂單，請透過「取消訂單」或「修改報名」來處理。' };
        }
    }

    // Self-cancel allowed: waitlist or pending_payment with non-confirmed order (single enrollment on order)

    // Cancel
    const { error } = await supabase
        .from('enrollments')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', enrollment.id);

    if (error) throw new Error(`取消失敗: ${error.message}`);

    // Promote first waitlisted person if an occupying seat was freed
    // (pending_payment occupies a seat; waitlist does not; enrolled is now blocked above)
    if (enrollment.status === 'pending_payment') {
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

    // Normalize pricing fields
    const pricingMode = data.pricing_mode || 'card';
    const isNtd = pricingMode === 'ntd';
    const enrollFull = data.enroll_full ?? true;
    const enrollSingle = data.enroll_single ?? true;

    // Defense-in-depth: reject ntd course with missing prices for enabled modes
    const enrollFullIdentity = data.enroll_full_identity || 'all';
    const enrollSingleIdentity = data.enroll_single_identity || 'all';
    if (isNtd) {
        if (enrollSingle) {
            if (data.price_member_single == null) throw new Error('NTD 計費模式下，開放單堂報名時必須設定社員單堂價格');
            if (enrollSingleIdentity !== 'member' && data.price_guest_single == null) throw new Error('NTD 計費模式下，開放單堂報名時必須設定非社員單堂價格');
        }
        if (enrollFull) {
            if (data.price_member_full == null) throw new Error('NTD 計費模式下，開放整期報名時必須設定社員整期價格');
            if (enrollFullIdentity !== 'member' && data.price_guest_full == null) throw new Error('NTD 計費模式下，開放整期報名時必須設定非社員整期價格');
        }
    }

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
            pricing_mode: pricingMode,
            price_member_single: isNtd ? (data.price_member_single ?? null) : null,
            price_guest_single:  isNtd ? (data.price_guest_single ?? null)  : null,
            price_member_full:   isNtd ? (data.price_member_full ?? null)   : null,
            price_guest_full:    isNtd ? (data.price_guest_full ?? null)    : null,
            enroll_full: enrollFull,
            enroll_single: enrollSingle,
            enroll_full_identity: enrollFullIdentity,
            enroll_single_identity: enrollSingleIdentity,
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
        session_date: s.date instanceof Date ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(s.date) : s.date,
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

    // Normalize pricing fields
    const pricingMode = data.pricing_mode || 'card';
    const isNtd = pricingMode === 'ntd';
    const enrollFull = data.enroll_full ?? true;
    const enrollSingle = data.enroll_single ?? true;
    const enrollFullIdentity = data.enroll_full_identity || 'all';
    const enrollSingleIdentity = data.enroll_single_identity || 'all';

    // Defense-in-depth: reject ntd course with missing prices for enabled modes
    if (isNtd) {
        if (enrollSingle) {
            if (data.price_member_single == null) throw new Error('NTD 計費模式下，開放單堂報名時必須設定社員單堂價格');
            if (enrollSingleIdentity !== 'member' && data.price_guest_single == null) throw new Error('NTD 計費模式下，開放單堂報名時必須設定非社員單堂價格');
        }
        if (enrollFull) {
            if (data.price_member_full == null) throw new Error('NTD 計費模式下，開放整期報名時必須設定社員整期價格');
            if (enrollFullIdentity !== 'member' && data.price_guest_full == null) throw new Error('NTD 計費模式下，開放整期報名時必須設定非社員整期價格');
        }
    }

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
            pricing_mode: pricingMode,
            price_member_single: isNtd ? (data.price_member_single ?? null) : null,
            price_guest_single:  isNtd ? (data.price_guest_single ?? null)  : null,
            price_member_full:   isNtd ? (data.price_member_full ?? null)   : null,
            price_guest_full:    isNtd ? (data.price_guest_full ?? null)    : null,
            enroll_full: enrollFull,
            enroll_single: enrollSingle,
            enroll_full_identity: enrollFullIdentity,
            enroll_single_identity: enrollSingleIdentity,
            enrollment_start_at: data.enrollment_start_at ? data.enrollment_start_at.toISOString() : null,
            enrollment_end_at: data.enrollment_end_at ? data.enrollment_end_at.toISOString() : null,
        })
        .eq('id', id);

    if (courseError) throw new Error(`更新課程失敗: ${courseError.message}`);

    // 2. Sync Sessions (sort by date to assign correct session_number)
    const sortedNextSessions = [...data.sessions].map((s: any) => {
        let dateStr = s.date;
        if (s.date instanceof Date) {
            dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(s.date);
        } else if (typeof s.date === 'string' && s.date.includes('T')) {
            dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date(s.date));
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

        // Check Requests (Leave, Makeup, Transfer) — rejected records don't block deletion
        const [leaveRes, makeupRes, transferRes] = await Promise.all([
            supabase.from('leave_requests').select('id', { count: 'exact', head: true }).in('session_id', idsToRemove).neq('status', 'rejected'),
            supabase.from('makeup_requests').select('id', { count: 'exact', head: true }).or(`original_session_id.in.(${idsToRemove.join(',')}),target_session_id.in.(${idsToRemove.join(',')})`).neq('status', 'rejected'),
            supabase.from('transfer_requests').select('id', { count: 'exact', head: true }).in('session_id', idsToRemove).neq('status', 'rejected')
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
    const adminClient = createAdminClient();

    // Get course_id for this session
    const { data: session } = await adminClient
        .from('course_sessions')
        .select('course_id')
        .eq('id', sessionId)
        .maybeSingle();

    if (!session) throw new Error('找不到堂次');

    // Build set of legitimate user IDs for this session
    const [{ data: fullEnrollments }, { data: singleEnrollments }, { data: makeups }, { data: transfers }] = await Promise.all([
        adminClient.from('enrollments').select('user_id').eq('course_id', session.course_id).eq('type', 'full').eq('status', 'enrolled'),
        adminClient.from('enrollments').select('user_id').eq('session_id', sessionId).eq('type', 'single').eq('status', 'enrolled'),
        adminClient.from('makeup_requests').select('user_id').eq('target_session_id', sessionId).eq('status', 'approved'),
        adminClient.from('transfer_requests').select('to_user_id').eq('session_id', sessionId).eq('status', 'approved'),
    ]);

    const legitimateUserIds = new Set<string>();
    (fullEnrollments ?? []).forEach(e => legitimateUserIds.add(e.user_id));
    (singleEnrollments ?? []).forEach(e => legitimateUserIds.add(e.user_id));
    (makeups ?? []).forEach(m => legitimateUserIds.add(m.user_id));
    (transfers ?? []).forEach(t => { if (t.to_user_id) legitimateUserIds.add(t.to_user_id); });

    // Filter records to only legitimate users; dedupe by userId (last write wins)
    const recordByUser = new Map<string, { userId: string; status: string; note?: string }>();
    for (const r of records) {
        if (legitimateUserIds.has(r.userId)) recordByUser.set(r.userId, r);
    }
    const filteredRecords = Array.from(recordByUser.values());

    // ── Server-side consistency: detect competing approved requests ──
    // Race-safe vs frontend stale data. Auto-cleanup orphan leave_requests
    // when overriding to present/absent; block transfer_out and present-over-makeup-source.
    // Note: guard messages must reach the leader, so use return { success: false }
    // instead of throw — saveAttendance is wrapped by safe() which masks throws in prod.
    const userIdsToCheck = Array.from(new Set(
        filteredRecords
            .filter(r => r.status === 'present' || r.status === 'absent')
            .map(r => r.userId)
    ));

    const leaveIdsToDelete: string[] = [];

    if (userIdsToCheck.length > 0) {
        const [
            { data: approvedLeaves, error: leavesErr },
            { data: approvedTransfersOut, error: transfersErr },
            { data: makeupsAsSource, error: makeupsErr },
        ] = await Promise.all([
            adminClient.from('leave_requests')
                .select('id, user_id')
                .eq('session_id', sessionId).in('user_id', userIdsToCheck).eq('status', 'approved'),
            adminClient.from('transfer_requests')
                .select('id, from_user_id')
                .eq('session_id', sessionId).in('from_user_id', userIdsToCheck).eq('status', 'approved'),
            adminClient.from('makeup_requests')
                .select('id, user_id, target_courses:target_course_id(name), target_sessions:target_session_id(session_date, session_number)')
                .eq('original_session_id', sessionId).in('user_id', userIdsToCheck).in('status', ['pending', 'approved']),
        ]);

        if (leavesErr || transfersErr || makeupsErr) {
            throw new Error(`儲存點名失敗（一致性檢查讀取錯誤）: ${(leavesErr || transfersErr || makeupsErr)?.message}`);
        }

        const leaveByUser = new Map((approvedLeaves ?? []).map((l: any) => [l.user_id, l.id]));
        const transferOutByUser = new Set((approvedTransfersOut ?? []).map((t: any) => t.from_user_id));
        const makeupSourceByUser = new Map((makeupsAsSource ?? []).map((m: any) => [m.user_id, m]));

        const conflictUserIds = Array.from(new Set([
            ...transferOutByUser,
            ...makeupSourceByUser.keys(),
        ]));
        const userNameMap = new Map<string, string>();
        if (conflictUserIds.length > 0) {
            const { data: names } = await adminClient.from('profiles').select('id, name').in('id', conflictUserIds);
            (names ?? []).forEach((n: any) => userNameMap.set(n.id, n.name || '學員'));
        }

        const blockMessages: string[] = [];

        for (const r of filteredRecords) {
            if (r.status !== 'present' && r.status !== 'absent') continue;

            if (transferOutByUser.has(r.userId)) {
                blockMessages.push(`${userNameMap.get(r.userId) ?? '某學員'}此堂次已轉讓給其他學員，無法直接點名。請先至「申請審核」處理該轉讓記錄。`);
                continue;
            }

            if (r.status === 'present' && makeupSourceByUser.has(r.userId)) {
                const m = makeupSourceByUser.get(r.userId);
                const ts = m?.target_sessions;
                const tc = m?.target_courses;
                const target = ts ? `${tc?.name ?? '某課'} 第 ${ts.session_number} 堂 (${ts.session_date})` : (tc?.name ?? '某課');
                blockMessages.push(`${userNameMap.get(r.userId) ?? '某學員'}此堂次的缺席已被用於補課至「${target}」，無法改為出席。請先至「申請審核」駁回該補課。`);
                continue;
            }

            if (leaveByUser.has(r.userId)) {
                leaveIdsToDelete.push(leaveByUser.get(r.userId)!);
            }
        }

        if (blockMessages.length > 0) {
            return { success: false, message: blockMessages.join('\n') };
        }
    }

    const upserts = filteredRecords.map(r => ({
        session_id: sessionId,
        user_id: r.userId,
        status: r.status,
        note: r.note ?? null,
        marked_by: user.id,
        marked_at: new Date().toISOString(),
    }));

    if (upserts.length > 0) {
        const { error } = await adminClient
            .from('attendance_records')
            .upsert(upserts, { onConflict: 'session_id,user_id' });

        if (error) throw new Error(`儲存點名失敗: ${error.message}`);
    }

    if (leaveIdsToDelete.length > 0) {
        const { error: cleanupErr } = await adminClient.from('leave_requests').delete().in('id', leaveIdsToDelete);
        if (cleanupErr) throw new Error(`儲存點名後清理請假紀錄失敗: ${cleanupErr.message}`);
    }

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

    const adminClient = createAdminClient();
    let error;
    if (existingLeave) {
        const res = await adminClient.from('leave_requests').update(payload).eq('id', existingLeave.id);
        error = res.error;
    } else {
        const res = await adminClient.from('leave_requests').insert(payload);
        error = res.error;
    }

    if (error) throw new Error(`請假申請失敗: ${error.message}`);

    // Cross-Intent Cleanup
    await Promise.all([
        adminClient.from('transfer_requests').delete().eq('session_id', sessionId).eq('from_user_id', user.id),
        adminClient.from('makeup_requests').delete().eq('original_session_id', sessionId).eq('user_id', user.id).eq('status', 'pending')
    ]);

    // Update attendance record immediately
    await adminClient.from('attendance_records').upsert({
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

    // 1. Guard checks
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

    if (decision === 'rejected') {
        // Block rejection if the absence from this session is being used as a makeup source
        const { data: dependentMakeup } = await supabase
            .from('makeup_requests')
            .select('id, target_course_id, target_session_id, target_sessions:target_session_id(session_date, session_number), target_courses:target_course_id(name)')
            .eq('original_session_id', req.session_id)
            .eq('user_id', req.user_id)
            .in('status', ['pending', 'approved'])
            .limit(1)
            .maybeSingle();

        if (dependentMakeup) {
            const targetCourse = (dependentMakeup.target_courses as any)?.name ?? '未知課程';
            const targetSession = dependentMakeup.target_sessions as any;
            const targetInfo = targetSession ? `${targetCourse} 第 ${targetSession.session_number} 堂 (${targetSession.session_date})` : targetCourse;
            return { success: false, message: `此堂次的缺席紀錄已被用於補課至「${targetInfo}」，請先至「補課紀錄」駁回該筆補課後再駁回此請假。` };
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
        const adminForCleanup = createAdminClient();
        await Promise.all([
            adminForCleanup.from('transfer_requests').delete().eq('session_id', req.session_id).eq('from_user_id', req.user_id),
            adminForCleanup.from('makeup_requests').delete().eq('original_session_id', req.session_id).eq('user_id', req.user_id).eq('status', 'pending')
        ]);
    } else {
        // If rejected, restore attendance to previous state
        const adminClient = createAdminClient();

        // Guard: if attendance has been overwritten by roll call (present/absent), block rejection
        const { data: currentAttendance } = await adminClient
            .from('attendance_records')
            .select('status')
            .eq('session_id', req.session_id)
            .eq('user_id', req.user_id)
            .maybeSingle();

        if (currentAttendance && (currentAttendance.status === 'present' || currentAttendance.status === 'absent')) {
            return { success: false, message: `此堂次已有點名紀錄（${currentAttendance.status === 'present' ? '出席' : '缺席'}），無法駁回請假。` };
        }

        // Check if this was a makeup student — restore to 'makeup' instead of deleting
        const { data: makeupCheck } = await adminClient
            .from('makeup_requests')
            .select('id')
            .eq('target_session_id', req.session_id)
            .eq('user_id', req.user_id)
            .eq('status', 'approved')
            .limit(1);

        if (makeupCheck && makeupCheck.length > 0) {
            await adminClient
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
            const { data: transferCheck } = await adminClient
                .from('transfer_requests')
                .select('id')
                .eq('session_id', req.session_id)
                .eq('to_user_id', req.user_id)
                .eq('status', 'approved')
                .limit(1);

            if (transferCheck && transferCheck.length > 0) {
                await adminClient
                    .from('attendance_records')
                    .upsert({
                        session_id: req.session_id,
                        user_id: req.user_id,
                        status: 'transfer_in',
                        marked_by: user.id,
                        marked_at: new Date().toISOString(),
                    }, { onConflict: 'session_id,user_id' });
            } else {
                // Regular student: remove attendance record (don't filter by status — it may have been overwritten by roll call)
                await adminClient
                    .from('attendance_records')
                    .delete()
                    .eq('session_id', req.session_id)
                    .eq('user_id', req.user_id);
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
    _targetCourseId: string,
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
    let userEnrollment = enrollments.find((e: any) => e.type === 'full');
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

    // Quota-only mode: no specific original session, or no full enrollment in original course
    // Find the user's actual full-enrolled normal/special course in the same group
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
            supabase.from('makeup_requests').select('original_course_id, original_session_id, quota_used').eq('user_id', user.id).in('original_course_id', courseIds).not('original_session_id', 'is', null).in('status', ['pending', 'approved']),
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

    // --- Capacity Guard (adminClient for cross-user SELECT) ---
    const adminForMakeup = createAdminClient();
    const [baseEnrollRes, makeupRes, leaveRes, transferRes] = await Promise.all([
        adminForMakeup.from('enrollments').select('*', { count: 'exact', head: true }).eq('course_id', target.course_id).eq('status', 'enrolled').or(`type.eq.full,session_id.eq.${targetSessionId}`),
        adminForMakeup.from('makeup_requests').select('*', { count: 'exact', head: true }).eq('target_session_id', targetSessionId).eq('status', 'approved'),
        adminForMakeup.from('leave_requests').select('*', { count: 'exact', head: true }).eq('session_id', targetSessionId).eq('status', 'approved'),
        adminForMakeup.from('transfer_requests').select('to_user_id').eq('course_id', target.course_id).eq('session_id', targetSessionId).eq('status', 'approved'),
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
    const { data: existingMakeup } = await adminForMakeup
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
        const { data: existingTransferForOriginal } = await adminForMakeup
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
        const res = await adminForMakeup.from('makeup_requests').update(payload).eq('id', existingMakeup.id);
        error = res.error;
    } else {
        const res = await adminForMakeup.from('makeup_requests').insert(payload);
        error = res.error;
    }

    if (error) throw new Error(`補課申請失敗: ${error.message}`);

    // Cleanup: Remove competing Leave/Transfer intents for the ORIGINAL session
    if (originalSessionId) {
        await Promise.all([
            adminForMakeup.from('leave_requests').delete().eq('session_id', originalSessionId).eq('user_id', user.id),
            adminForMakeup.from('transfer_requests').delete().eq('session_id', originalSessionId).eq('from_user_id', user.id)
        ]);
    }

    // Update attendance record immediately for target session
    await adminForMakeup.from('attendance_records').upsert({
        session_id: targetSessionId,
        user_id: user.id,
        status: 'makeup',
        marked_by: user.id,
        marked_at: new Date().toISOString(),
    }, { onConflict: 'session_id,user_id' });

    // If using manual quota (no original session = no absence source), decrement profiles.makeup_quota
    if (!originalSessionId && manualAdj > 0) {
        const adminClient = createAdminClient();
        await adminClient
            .from('profiles')
            .update({ makeup_quota: Math.max(0, manualAdj - 1) })
            .eq('id', user.id);
    }

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

    // 1. Get available missed sessions + manual quota
    const { getAvailableMakeupQuotaSessions } = await import('./queries');
    const { sessions: available, manualQuota } = await getAvailableMakeupQuotaSessions(user.id);

    // Get target group ID
    const { data: targetCourse } = await supabase.from('courses').select('group_id').eq('id', targetCourseId).single();
    if (!targetCourse) throw new Error('目標課程不存在');

    // Filter absences by same group and only those with quota available
    const availableQuotaSessions = available
        .filter((s: any) => s.groupId === targetCourse.group_id && !s.isQuotaFull)
        .sort((a: any, b: any) => a.date.localeCompare(b.date));

    // Total available = absences-based + manual quota
    const totalAvailable = availableQuotaSessions.length + manualQuota;

    if (totalAvailable < targetSessionIds.length) {
        throw new Error(`補課額度不足。您選擇了 ${targetSessionIds.length} 堂課，但只有 ${totalAvailable} 個可用額度。`);
    }

    // 2. Pair and submit
    // First use absence-based sources (with original session), then quota-only mode (manual quota)
    const results = [];
    for (let i = 0; i < targetSessionIds.length; i++) {
        const targetSid = targetSessionIds[i];
        const source = availableQuotaSessions[i]; // undefined if using manual quota

        try {
            const res = await internalSubmitMakeupRequest(
                supabase,
                user,
                source?.courseId || targetCourseId,   // fallback to target course for quota-only
                source?.sessionId || null,             // null = quota-only mode
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
    const adminClient = createAdminClient();

    // Guard for rejection: if attendance has been overwritten by roll call, block
    if (decision === 'rejected') {
        const { data: currentAtt } = await adminClient
            .from('attendance_records')
            .select('status')
            .eq('session_id', req.target_session_id)
            .eq('user_id', req.user_id)
            .maybeSingle();

        if (currentAtt && (currentAtt.status === 'present' || currentAtt.status === 'absent')) {
            return { success: false, message: `此堂次已有點名紀錄（${currentAtt.status === 'present' ? '出席' : '缺席'}），無法駁回補課。` };
        }
    }

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

        // Re-deduct makeup_quota (handles rejected→re-approved case)
        if (!req.original_session_id) {
            const { data: profile } = await adminClient
                .from('profiles')
                .select('makeup_quota')
                .eq('id', req.user_id)
                .maybeSingle();
            if (profile) {
                await adminClient
                    .from('profiles')
                    .update({ makeup_quota: Math.max(0, (profile.makeup_quota ?? 0) - 1) })
                    .eq('id', req.user_id);
            }
        }
    } else {
        // If rejected, wipe the attendance record to clear the slot
        await supabase
            .from('attendance_records')
            .delete()
            .eq('session_id', req.target_session_id)
            .eq('user_id', req.user_id);

        // Refund makeup_quota only for quota-only (幹部贈予) makeups
        // Absence-based makeups don't need refund — the rejected status automatically
        // excludes them from the "used" count, naturally restoring the quota
        if (!req.original_session_id) {
            const { data: profile } = await adminClient
                .from('profiles')
                .select('makeup_quota')
                .eq('id', req.user_id)
                .maybeSingle();
            if (profile) {
                await adminClient
                    .from('profiles')
                    .update({ makeup_quota: (profile.makeup_quota ?? 0) + 1 })
                    .eq('id', req.user_id);
            }
        }
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
        const adminForCandidates = createAdminClient();
        const [{ data: singleEnrolled }, { data: makeupUsers }, { data: transferInUsers }] = await Promise.all([
            adminForCandidates.from('enrollments').select('user_id')
                .eq('course_id', courseId).eq('session_id', sessionId).eq('status', 'enrolled').eq('type', 'single'),
            adminForCandidates.from('makeup_requests').select('user_id')
                .eq('target_session_id', sessionId).eq('status', 'approved'),
            adminForCandidates.from('transfer_requests').select('to_user_id')
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

    const adminForTransfer = createAdminClient();
    let result;
    if (existingTransfer) {
        result = await adminForTransfer.from('transfer_requests').update(payload).eq('id', existingTransfer.id).select().single();
    } else {
        result = await adminForTransfer.from('transfer_requests').insert(payload).select().single();
    }

    const { error } = result;

    if (error) throw new Error(`轉讓申請失敗: ${error.message}`);

    // Cross-Intent Cleanup
    await Promise.all([
        adminForTransfer.from('leave_requests').delete().eq('session_id', sessionId).eq('user_id', user.id),
        adminForTransfer.from('makeup_requests').delete().eq('original_session_id', sessionId).eq('user_id', user.id).eq('status', 'pending')
    ]);
    await Promise.all([
        adminForTransfer.from('attendance_records').upsert({
            session_id: sessionId,
            user_id: user.id,
            status: 'transfer_out',
            marked_by: user.id,
            marked_at: new Date().toISOString(),
        }, { onConflict: 'session_id,user_id' }),
        toUserId ? adminForTransfer.from('attendance_records').upsert({
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

    const adminForReview = createAdminClient();
    if (decision === 'approved') {

        // Mark original user as transfer_out, new user as transfer_in
        await adminForReview.from('attendance_records').upsert([
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
            adminForReview.from('leave_requests').delete().eq('session_id', req.session_id).eq('user_id', req.from_user_id),
            adminForReview.from('makeup_requests').delete().eq('original_session_id', req.session_id).eq('user_id', req.from_user_id).eq('status', 'pending')
        ]);
    } else {
        // If rejected, clear the attendance rows that were set by the approval.
        // Filter by status='transfer_out'/'transfer_in' so we don't accidentally
        // wipe a row already updated by another flow (e.g. rollcall after race).
        // For from_user with own enrollment, deleting the row is safe — rollcall
        // will create a fresh row when leader marks attendance.
        await Promise.all([
            adminForReview.from('attendance_records').delete()
                .eq('session_id', req.session_id).eq('user_id', req.from_user_id)
                .eq('status', 'transfer_out'),
            req.to_user_id ? adminForReview.from('attendance_records').delete()
                .eq('session_id', req.session_id).eq('user_id', req.to_user_id)
                .eq('status', 'transfer_in') : Promise.resolve(),
        ]);
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

    // Fetch old valid_until before updating (for cascade)
    const { data: oldGroup } = await supabase
        .from('member_groups')
        .select('valid_until')
        .eq('id', id)
        .single();
    const oldValidUntil = oldGroup?.valid_until;

    const { error } = await supabase
        .from('member_groups')
        .update({ name, valid_until: validUntil })
        .eq('id', id);

    if (error) throw new Error(`修改群組失敗: ${error.message}`);

    // Cascade: update card_purchase orders whose expires_at matched the old valid_until
    if (oldValidUntil && oldValidUntil !== validUntil) {
        const adminClient = createAdminClient();

        // Find members in this group
        const { data: members } = await adminClient
            .from('profiles')
            .select('id')
            .eq('member_group_id', id);

        if (members && members.length > 0) {
            const memberIds = members.map(m => m.id);

            // Update confirmed card_purchase orders whose expires_at = old valid_until
            const { error: cascadeErr } = await adminClient
                .from('orders')
                .update({ expires_at: validUntil })
                .in('user_id', memberIds)
                .eq('status', 'confirmed')
                .eq('order_type', 'card_purchase')
                .eq('expires_at', oldValidUntil);

            if (cascadeErr) {
                throw new Error(`群組已更新但堂卡到期日同步失敗: ${cascadeErr.message}`);
            }

            // Recompute balance for each affected user
            const { syncCardBalance } = await import('./card-utils');
            for (const m of members) {
                await syncCardBalance(m.id);
            }
        }
    }

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
            employee_id: data.employee_id?.toLowerCase().trim() || null,
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
            .update({ employee_id: data.employee_id?.toLowerCase().trim() })
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

    // Create a confirmed order (admin grant)
    const { error: orderError } = await adminClient
        .from('orders')
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
            order_type: 'card_purchase',
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

export async function updateCardPoolExpiry(
    orderId: string,
    newExpiresAt: string
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以修改堂卡到期日');

    const adminClient = createAdminClient();
    const { error } = await adminClient
        .from('orders')
        .update({ expires_at: newExpiresAt })
        .eq('id', orderId)
        .eq('order_type', 'card_purchase');

    if (error) return { success: false, message: `修改失敗: ${error.message}` };

    // Sync balance for the order's owner
    const { data: order } = await adminClient.from('orders').select('user_id').eq('id', orderId).eq('order_type', 'card_purchase').single();
    if (order) {
        const { syncCardBalance } = await import('./card-utils');
        await syncCardBalance(order.user_id);
    }

    revalidatePath('/', 'layout');
    return { success: true, message: `到期日已更新為 ${newExpiresAt}` };
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
// Order Actions (card_purchase, course_fee, membership_fee)
// ------------------------------------------------------------------

export async function createCardOrder(quantity: number, includeMembership: boolean = false): Promise<{ success: boolean; message: string; orderId?: string }> {
    const { supabase, user } = await getCurrentUser();

    // Check purchase window is open
    const config = await getSystemConfig();
    const todayStr = getTaipeiToday();
    const purchaseMode = config['card_purchase_mode'] ?? 'manual';

    if (purchaseMode === 'monthly_first_week') {
        // Automatic window: first Monday-to-Friday of each month
        if (!isCardWindowOpen(todayStr)) {
            const { start, end } = getCardPurchaseWindow(todayStr);
            throw new Error(`購卡時段未開放，本月開放期間為 ${start} ~ ${end}`);
        }
    } else {
        // Manual mode (default): use card_purchase_open + start/end toggles
        if (config['card_purchase_open'] !== 'true') {
            throw new Error('堂卡購買時段尚未開放');
        }

        const startDate = config['card_purchase_start'];
        if (startDate && startDate.trim() !== '' && todayStr < startDate) {
            throw new Error(`購卡時段尚未開始 (預計開放日期: ${startDate})`);
        }

        const endDate = config['card_purchase_end'];
        if (endDate && endDate.trim() !== '' && todayStr > endDate) {
            throw new Error(`購卡時段已結束 (截止日期: ${endDate})`);
        }
    }

    const rawUnit = parseInt(config['card_purchase_unit'] ?? '5', 10);
    const qtyCheck = validatePurchaseQuantity(quantity, rawUnit);
    if (!qtyCheck.ok) {
        return { success: false, message: qtyCheck.message! };
    }

    const minPurchase = parseInt(config['card_min_purchase'] ?? '5', 10);
    if (quantity < minPurchase) {
        throw new Error(`最小購買數量為 ${minPurchase} 堂`);
    }

    // Get user profile to determine price
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, member_valid_until, member_group_id, member_groups ( valid_until )')
        .eq('id', user.id)
        .maybeSingle();

    const groupValidUntil = (profile?.member_groups as any)?.valid_until;
    const isMember = isMemberActive(
        { role: profile?.role ?? 'guest', member_valid_until: profile?.member_valid_until ?? null, groupValidUntil: groupValidUntil ?? null },
        getTaipeiToday()
    );
    const unitPrice = (isMember || includeMembership)
        ? parseInt(config['card_price_member'] ?? '270', 10)
        : parseInt(config['card_price_non_member'] ?? '370', 10);

    // Card expiry: use buyer's own member group valid_until; fall back to year-end
    // Use Taipei year for the fallback to avoid UTC offset bug on Vercel
    // (during the first hours of Jan 1 Asia/Taipei, UTC year is still previous year)
    const expiresAt = groupValidUntil
        ? groupValidUntil
        : `${getTaipeiToday().slice(0, 4)}-12-31`;

    const membershipPrice = includeMembership ? 1800 : 0;
    const totalAmount = (quantity * unitPrice) + membershipPrice;

    const { data, error } = await supabase
        .from('orders')
        .insert({
            user_id: user.id,
            quantity,
            unit_price: unitPrice,
            total_amount: totalAmount,
            status: 'pending',
            include_membership: includeMembership,
            expires_at: expiresAt,
            order_type: 'card_purchase',
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

    // Verify ownership (works for any order_type: card_purchase, course_fee, etc.)
    const { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('id', orderId)
        .eq('user_id', user.id)
        .in('status', ['pending', 'remitted'])
        .maybeSingle();
    if (!order) throw new Error('訂單不存在或已處理');

    // Use adminClient — RLS with_check blocks status change from 'pending' to 'remitted'
    const adminClient = createAdminClient();
    const { error } = await adminClient
        .from('orders')
        .update({
            status: 'remitted',
            remittance_bank_code: bankCode,
            remittance_account_last5: last5,
            remittance_date: remittanceDate,
            remittance_note: note ?? null,
        })
        .eq('id', orderId);

    if (error) throw new Error(`填寫匯款資訊失敗: ${error.message}`);

    return { success: true, message: '匯款資訊已送出，等待財務確認' };
}

export async function cancelCardOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    return cancelOrder(orderId);
}

/** Cancel an order (any order_type). Allowed for ADMIN or the ORDER OWNER.
 *  For course_fee: linked enrollments are set to cancelled with cancel_reason. */
export async function cancelOrder(orderId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // Fetch caller role
    const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    const isAdmin = callerProfile?.role === 'admin';

    // Fetch order (use adminClient for cross-user access when admin)
    const adminClient = createAdminClient();
    const { data: order } = await adminClient
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    if (!order) return { success: false, message: '找不到訂單' };

    // Authorization: admin or order owner
    if (!isAdmin && order.user_id !== user.id) {
        return { success: false, message: '只有訂單本人或幹部可以取消訂單' };
    }

    // Idempotency: already cancelled/rejected — nothing to do
    if (order.status === 'cancelled' || order.status === 'rejected') {
        return { success: true, message: '訂單已取消' };
    }
    if (order.status !== 'pending' && order.status !== 'remitted') {
        return { success: false, message: '此收費狀態已無法取消' };
    }

    const { error } = await adminClient
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', orderId);

    if (error) return { success: false, message: '取消失敗' };

    // Cancel linked enrollments (releases seats since cancelled does not occupy)
    if (order.order_type === 'course_fee' || order.order_type === 'card_purchase') {
        const { error: enrollError } = await adminClient
            .from('enrollments')
            .update({
                status: 'cancelled',
                cancel_reason: reason ?? '訂單取消',
                cancelled_at: new Date().toISOString(),
            })
            .eq('order_id', orderId)
            .in('status', ['pending_payment', 'pending_vote']);

        if (enrollError) {
            return { success: false, message: `訂單已取消，但更新報名狀態失敗: ${enrollError.message}` };
        }
    }

    return { success: true, message: '訂單已取消' };
}

/** Admin: confirm an order. Delegates to confirmOrder which branches on order_type. */
export async function confirmCardOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    return confirmOrder(orderId);
}

/** Admin: confirm an order (any order_type).
 *  card_purchase => issue cards + recompute balance (existing behavior).
 *  course_fee => set linked enrollments to enrolled.
 *  membership_fee => no-op side-effects (future). */
export async function confirmOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // ADMIN-ONLY: financial approval action
    const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (callerProfile?.role !== 'admin') {
        return { success: false, message: '只有幹部可以確認訂單' };
    }

    const adminClient = createAdminClient();
    const { data: order } = await adminClient
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

    if (!order) throw new Error('訂單不存在');

    // Terminal-status guard: only pending/remitted orders can be confirmed
    if (order.status === 'confirmed') return { success: false, message: '訂單已確認' };
    if (order.status === 'cancelled' || order.status === 'rejected') {
        return { success: false, message: '此訂單已結案，無法確認' };
    }

    // Pre-confirm guard: card_purchase with linked pending enrollments must have enough cards
    if (order.order_type === 'card_purchase') {
        const { data: linkedEnrollments } = await adminClient
            .from('enrollments')
            .select('id, course_id, courses ( cards_per_session, course_sessions ( id, session_date ) )')
            .eq('order_id', orderId)
            .eq('status', 'pending_payment');

        if (linkedEnrollments && linkedEnrollments.length > 0) {
            const taipeiToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
            let totalCardsNeeded = 0;
            for (const e of linkedEnrollments) {
                const course = e.courses as any;
                const cardsPerSession = course?.cards_per_session ?? 0;
                const futureSessions = (course?.course_sessions ?? []).filter(
                    (s: any) => s.session_date >= taipeiToday
                );
                totalCardsNeeded += cardsPerSession * futureSessions.length;
            }

            const { getAvailableCardBalance } = await import('./card-utils');
            const { available: currentAvailable } = await getAvailableCardBalance(order.user_id);
            const projectedAvailable = currentAvailable + order.quantity;

            if (projectedAvailable < totalCardsNeeded) {
                return {
                    success: false,
                    message: `堂卡不足：確認後將有 ${projectedAvailable} 張，但關聯報名需要 ${totalCardsNeeded} 張。請聯繫學員處理。`,
                };
            }
        }
    }

    // Update order status (use adminClient — bypasses RLS for cross-user orders)
    const { error: orderError } = await adminClient
        .from('orders')
        .update({
            status: 'confirmed',
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString(),
        })
        .eq('id', orderId);

    if (orderError) throw new Error(`確認訂單失敗: ${orderError.message}`);

    // Branch on order_type for side-effects
    if (order.order_type === 'card_purchase') {
        // --- card_purchase: issue cards + recompute balance (existing behavior) ---
        const { syncCardBalance } = await import('./card-utils');
        const newBalance = await syncCardBalance(order.user_id);

        // If membership included, upgrade user to member and assign to latest group
        if (order.include_membership) {
            const { data: upProfile } = await adminClient
                .from('profiles')
                .select('role')
                .eq('id', order.user_id)
                .single();

            // Get latest member group
            const { data: latestGroup } = await adminClient
                .from('member_groups')
                .select('id')
                .order('valid_until', { ascending: false })
                .limit(1)
                .maybeSingle();

            const updateData: any = { member_group_id: latestGroup?.id || null };
            if (upProfile?.role === 'guest') {
                updateData.role = 'member';
            }

            await adminClient
                .from('profiles')
                .update(updateData)
                .eq('id', order.user_id);
        }

        // Record transaction
        await adminClient.from('card_transactions').insert({
            user_id: order.user_id,
            type: 'purchase',
            amount: order.quantity,
            balance_after: newBalance,
            order_id: orderId,
            note: `購買 ${order.quantity} 堂卡${order.include_membership ? '（含加入社員）' : ''}（訂單 ${orderId.slice(0, 8)}）`,
            created_by: user.id,
        });

        // Activate linked pending_payment enrollments (shortfall card order from group enrollment)
        const { data: linkedPending } = await adminClient
            .from('enrollments')
            .select('id, course_id, courses ( cards_per_session, course_sessions ( id, session_date ) )')
            .eq('order_id', orderId)
            .eq('status', 'pending_payment');

        if (linkedPending && linkedPending.length > 0) {
            const { deductCardsFIFO } = await import('./card-utils');
            const taipeiNow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
            const activated: string[] = [];

            for (const enrollment of linkedPending) {
                const course = enrollment.courses as any;
                const cardsPerSession = course?.cards_per_session ?? 0;
                const sessions = (course?.course_sessions ?? []) as { id: string; session_date: string }[];
                const futureSessions = sessions.filter(s => s.session_date >= taipeiNow);
                const cardsToDeduct = cardsPerSession * futureSessions.length;

                if (cardsToDeduct > 0) {
                    const lastSession = [...sessions].sort((a, b) => b.session_date.localeCompare(a.session_date))[0]?.session_date ?? taipeiNow;
                    try {
                        await deductCardsFIFO(
                            order.user_id,
                            cardsToDeduct,
                            lastSession,
                            `整期報名扣卡（課程 ${enrollment.course_id.slice(0, 8)}，訂單 ${orderId.slice(0, 8)}）`,
                            enrollment.id,
                            user.id,
                        );
                    } catch {
                        continue;
                    }
                }
                activated.push(enrollment.id);
            }

            if (activated.length > 0) {
                await adminClient.from('enrollments')
                    .update({ status: 'enrolled' })
                    .in('id', activated);
            }

            const msg = activated.length === linkedPending.length
                ? `已核發 ${order.quantity} 堂卡並啟動 ${linkedPending.length} 筆報名`
                : `已核發 ${order.quantity} 堂卡，啟動 ${activated.length}/${linkedPending.length} 筆報名（部分堂卡不足）`;
            return { success: true, message: msg };
        }

        return { success: true, message: `已核發 ${order.quantity} 堂卡給使用者` };

    } else if (order.order_type === 'course_fee') {
        // --- course_fee: flip linked enrollments to enrolled ---
        const { data: updated, error: enrollError } = await adminClient
            .from('enrollments')
            .update({ status: 'enrolled' })
            .eq('order_id', orderId)
            .in('status', ['pending_payment', 'pending_vote'])
            .select('id');

        if (enrollError) throw new Error(`更新報名狀態失敗: ${enrollError.message}`);

        const count = updated?.length ?? 0;
        return { success: true, message: `已確認繳費，${count} 筆報名已生效` };

    } else {
        // membership_fee or future types — order status already updated, no extra side-effects
        return { success: true, message: '訂單已確認' };
    }
}

/** Admin: reject an order. Delegates to rejectOrder which branches on order_type. */
export async function rejectCardOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    return rejectOrder(orderId);
}

/** Admin: reject an order (any order_type).
 *  card_purchase => sync card balance (existing behavior).
 *  course_fee => cancel linked enrollments with reason.
 *  membership_fee => no-op side-effects (future). */
export async function rejectOrder(orderId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    // ADMIN-ONLY: financial approval action
    const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (callerProfile?.role !== 'admin') {
        return { success: false, message: '只有幹部可以駁回訂單' };
    }

    const adminClient = createAdminClient();

    // 1. Get order (any type) — use adminClient for cross-user access
    const { data: order } = await adminClient.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (!order) throw new Error('訂單不存在');

    // Status guard: reject only valid from pending/remitted
    if (order.status === 'confirmed') {
        return { success: false, message: '訂單已確認，無法駁回；已確認訂單如需退費請人工處理' };
    }
    if (order.status === 'cancelled' || order.status === 'rejected') {
        return { success: false, message: '此訂單已結案，無法再駁回' };
    }

    // 2. Update status to rejected (use adminClient for cross-user orders)
    const { error } = await adminClient
        .from('orders')
        .update({
            status: 'rejected',
            confirmed_by: user.id,
            confirmed_at: new Date().toISOString(),
        })
        .eq('id', orderId);

    if (error) return { success: false, message: '駁回失敗' };

    // 3. Branch on order_type for side-effects
    if (order.order_type === 'card_purchase') {
        // Sync balance from pools (rejected orders are excluded)
        const { syncCardBalance } = await import('./card-utils');
        await syncCardBalance(order.user_id);
    }

    // Cancel linked enrollments for both card_purchase and course_fee
    if (order.order_type === 'card_purchase' || order.order_type === 'course_fee') {
        const { error: enrollError } = await adminClient
            .from('enrollments')
            .update({
                status: 'cancelled',
                cancel_reason: reason ?? '訂單駁回',
                cancelled_at: new Date().toISOString(),
            })
            .eq('order_id', orderId)
            .in('status', ['pending_payment', 'pending_vote', 'enrolled']);

        if (enrollError) {
            return { success: false, message: `訂單已駁回，但更新報名狀態失敗: ${enrollError.message}` };
        }
    }
    // membership_fee or future types: no extra side-effects

    return { success: true, message: '訂單已駁回' };
}

// ------------------------------------------------------------------
// Course Fee Order Creation
// ------------------------------------------------------------------

/** INTERNAL — not a server action; do not export.
 *  Create a course_fee order and link enrollments to it.
 *  Called by submitGroupEnrollment (Phase 5) when pricing_mode=ntd.
 *  The caller is responsible for auth (getCurrentUser) before invoking.
 *  Inserts orders(order_type=course_fee, status=pending), then sets
 *  enrollments.order_id for the given enrollmentIds. */
async function createCourseFeeOrder(args: {
    userId: string;
    courseGroupId: string;
    amount: number;
    enrollmentIds: string[];
}): Promise<{ orderId: string }> {
    const { userId, courseGroupId, amount, enrollmentIds } = args;
    if (!enrollmentIds.length) throw new Error('必須提供至少一筆報名紀錄');

    const adminClient = createAdminClient();

    // Insert the order
    const { data: order, error: orderError } = await adminClient
        .from('orders')
        .insert({
            user_id: userId,
            order_type: 'course_fee' as const,
            quantity: 1,          // not applicable for course_fee; 1 to satisfy CHECK(quantity>0)
            used: 0,
            unit_price: 0,        // not applicable for course_fee
            total_amount: 0,      // not applicable for course_fee
            amount,               // actual NTD amount for course_fee
            status: 'pending',
            course_group_id: courseGroupId,
        })
        .select('id')
        .single();

    if (orderError || !order) throw new Error(`建立繳費單失敗: ${orderError?.message ?? 'unknown'}`);

    // Link enrollments to this order
    const { error: linkError } = await adminClient
        .from('enrollments')
        .update({ order_id: order.id })
        .in('id', enrollmentIds);

    if (linkError) throw new Error(`關聯報名紀錄失敗: ${linkError.message}`);

    return { orderId: order.id };
}

// ------------------------------------------------------------------
// Single Enrollment Review (Admin)
// ------------------------------------------------------------------

export async function reviewSingleEnrollment(
    enrollmentId: string,
    decision: 'approved' | 'rejected'
): Promise<{ success: boolean; message: string }> {
    const { supabase, user } = await getCurrentUser();

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new Error('只有幹部可以執行此操作');

    const adminClient = createAdminClient();

    // 1. Fetch enrollment with session info
    const { data: enrollment } = await adminClient
        .from('enrollments')
        .select('*, course_sessions!enrollments_session_id_fkey(session_date, session_number, course_id), courses!enrollments_course_id_fkey(capacity, cards_per_session)')
        .eq('id', enrollmentId)
        .maybeSingle();

    if (!enrollment) return { success: false, message: '找不到報名紀錄' };
    if (enrollment.type !== 'single') return { success: false, message: '只能操作單堂報名' };

    const cardsPerSession: number = (enrollment.courses as any)?.cards_per_session ?? 1;

    const sessionDate = (enrollment.course_sessions as any)?.session_date;
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    // 2. Guard: past session
    if (sessionDate && sessionDate < todayStr) {
        return { success: false, message: '此堂次已過期，無法操作。' };
    }

    const { syncCardBalance } = await import('./card-utils');

    if (decision === 'rejected') {
        // Guard: enrollment must be 'enrolled' (prevents double-refund)
        if (enrollment.status !== 'enrolled') return { success: false, message: '此報名已被處理' };

        // Guard: has attendance record
        const { data: attendance } = await adminClient
            .from('attendance_records')
            .select('id, status')
            .eq('session_id', enrollment.session_id)
            .eq('user_id', enrollment.user_id)
            .maybeSingle();

        if (attendance && attendance.status !== 'unmarked') {
            if (attendance.status === 'leave') {
                return { success: false, message: '此堂次已有請假紀錄，請先駁回請假後再駁回報名。' };
            }
            return { success: false, message: `此堂次已有點名紀錄（${attendance.status}），無法駁回。` };
        }

        // Update status to cancelled (use conditional update to prevent concurrent double-refund)
        const { data: updated } = await adminClient
            .from('enrollments')
            .update({ status: 'cancelled' })
            .eq('id', enrollmentId)
            .eq('status', 'enrolled')
            .select();

        if (!updated || updated.length === 0) return { success: false, message: '此報名已被處理' };

        // Delete attendance record if exists
        if (attendance) {
            await adminClient.from('attendance_records').delete().eq('id', attendance.id);
        }

        // Refund card(s): distribute refund across pools (earliest-expiring first)
        const { data: pools } = await adminClient
            .from('orders')
            .select('id, used, expires_at')
            .eq('user_id', enrollment.user_id)
            .eq('status', 'confirmed')
            .eq('order_type', 'card_purchase')
            .gt('used', 0)
            .order('expires_at', { ascending: true, nullsFirst: false });

        let refundRemaining = cardsPerSession;
        for (const pool of (pools ?? [])) {
            if (refundRemaining <= 0) break;
            const refundFromPool = Math.min(pool.used, refundRemaining);
            await adminClient
                .from('orders')
                .update({ used: pool.used - refundFromPool })
                .eq('id', pool.id);
            refundRemaining -= refundFromPool;
        }

        await syncCardBalance(enrollment.user_id);
        revalidatePath('/', 'layout');
        return { success: true, message: '已駁回單堂報名，堂卡已歸還' };

    } else {
        // Re-approve: status must be 'cancelled'
        if (enrollment.status !== 'cancelled') return { success: false, message: '此報名不需要重新核准' };

        // Check capacity
        const [{ count: enrolledCount }, { count: makeupCount }, { count: leaveCount }, { data: transferData }] = await Promise.all([
            adminClient.from('enrollments').select('*', { count: 'exact', head: true }).eq('course_id', enrollment.course_id).eq('status', 'enrolled').or(`type.eq.full,session_id.eq.${enrollment.session_id}`),
            adminClient.from('makeup_requests').select('*', { count: 'exact', head: true }).eq('target_session_id', enrollment.session_id).eq('status', 'approved'),
            adminClient.from('leave_requests').select('*', { count: 'exact', head: true }).eq('session_id', enrollment.session_id).eq('status', 'approved'),
            adminClient.from('transfer_requests').select('to_user_id').eq('session_id', enrollment.session_id).eq('status', 'approved'),
        ]);
        const transferInCount = (transferData ?? []).filter((t: any) => !!t.to_user_id).length;
        const transferOutCount = (transferData ?? []).length;
        const occupancy = (enrolledCount ?? 0) + (makeupCount ?? 0) + transferInCount - (leaveCount ?? 0) - transferOutCount;
        const capacity = (enrollment.courses as any)?.capacity ?? 999;
        if (occupancy >= capacity) {
            return { success: false, message: '此堂次已額滿，無法重新核准。' };
        }

        // Check card balance
        const { getAvailableCardBalance } = await import('./card-utils');
        const cardInfo = await getAvailableCardBalance(enrollment.user_id, sessionDate);
        if (cardInfo.available < cardsPerSession) {
            return { success: false, message: '學員堂卡餘額不足，無法重新核准' };
        }

        // Restore enrollment first (if this fails, no card is deducted)
        const { data: restored } = await adminClient
            .from('enrollments')
            .update({ status: 'enrolled' })
            .eq('id', enrollmentId)
            .eq('status', 'cancelled')
            .select();

        if (!restored || restored.length === 0) return { success: false, message: '此報名已被處理' };

        // Then deduct card(s)
        const { deductCardsFIFO } = await import('./card-utils');
        await deductCardsFIFO(enrollment.user_id, cardsPerSession, sessionDate, '重新核准單堂報名');

        revalidatePath('/', 'layout');
        return { success: true, message: '已重新核准單堂報名，堂卡已扣除' };
    }
}

// ------------------------------------------------------------------
// Group Enrollment Wizard — submitGroupEnrollment (Phase 5.3)
// ------------------------------------------------------------------

export interface GroupEnrollmentSelection {
    courseId: string;
    mode: 'full';
    wantsLeader: boolean;
    /** Accepted in the payload shape for Task 6.2 vote-writing; NOT persisted here. */
    votes?: Array<{ pollId: string; optionIds: string[] }>;
}

export interface GroupEnrollmentPayload {
    groupId: string;
    selections: GroupEnrollmentSelection[];
    buyCards?: { quantity: number; remittance?: { bankCode: string; last5: string; remittanceDate: string; note?: string } };
    includeMembership?: boolean;
}

export type PerCourseStatus = 'enrolled' | 'pending_payment' | 'pending_vote' | 'full' | 'rejected';

export interface PerCourseResult {
    courseId: string;
    status: PerCourseStatus;
    reason?: string;
}

export interface GroupEnrollmentResult {
    perCourse: PerCourseResult[];
    orderId?: string;
    cardOrderId?: string;
}

/**
 * Multi-course group enrollment wizard action.
 *
 * Processes each selected course independently — one course failing does NOT
 * abort the others. Routes each course by its pricing_mode and MV-poll status.
 *
 * NEVER trusts client-sent amounts — all prices are server-resolved via resolvePrice.
 */
export async function submitGroupEnrollment(
    payload: GroupEnrollmentPayload
): Promise<GroupEnrollmentResult> {
    const { user } = await getCurrentUser();
    const adminClient = createAdminClient();

    // ── 1. Auth & profile fetch ──
    const { data: profile } = await adminClient
        .from('profiles')
        .select('role, member_valid_until, member_group_id, member_groups ( valid_until )')
        .eq('id', user.id)
        .maybeSingle();

    if (!profile) throw new Error('使用者資料不存在');

    // ── 2. Compute isMember for pricing + identity guards ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupValidUntil = (profile.member_groups as any)?.valid_until ?? null;
    const taipeiToday = getTaipeiToday();
    const memberActive = isMemberActive(
        { role: profile.role, member_valid_until: profile.member_valid_until ?? null, groupValidUntil },
        taipeiToday
    );

    // ── 4. Fetch all selected courses with sessions count ──
    const courseIds = payload.selections.map(s => s.courseId);
    const { data: courses } = await adminClient
        .from('courses')
        .select('*, course_sessions(id, session_date, session_number)')
        .in('id', courseIds);

    const courseMap = new Map((courses ?? []).map(c => [c.id, c]));

    // ── 5. Check which courses have open polls (MV detection) ──
    const { data: openPolls } = await adminClient
        .from('course_polls')
        .select('id, course_id')
        .in('course_id', courseIds)
        .eq('status', 'open');

    const mvCourseIds = new Set((openPolls ?? []).map(p => p.course_id));

    // ── 6. Check group phase1 window (single check since all courses share groupId) ──
    const phase1Msg = await guardGroupPhase1Window(adminClient, payload.groupId);

    // ── 6b. Validate buyCards quantity upfront (fail-fast before any enrollment) ──
    if (payload.buyCards) {
        const config = await getSystemConfig();
        const rawUnit = parseInt(config['card_purchase_unit'] ?? '5', 10);
        const qtyCheck = validatePurchaseQuantity(payload.buyCards.quantity, rawUnit);
        if (!qtyCheck.ok) {
            throw new Error(qtyCheck.message!);
        }
    }

    // ── 7. Process each selection independently ──
    const perCourse: PerCourseResult[] = [];
    const ntdEnrollmentIds: string[] = [];
    let ntdTotalAmount = 0;
    const cardPendingEnrollmentIds: string[] = [];

    for (const sel of payload.selections) {
        const course = courseMap.get(sel.courseId);
        if (!course) {
            perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '課程不存在' });
            continue;
        }

        // ── Guards ──
        // Guard: enroll_full
        const fullMsg = guardEnrollFull(course);
        if (fullMsg) {
            perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '此課程未開放整期報名' });
            continue;
        }

        // Guard: identity — member-only full enrollment
        const identMsg = guardEnrollFullIdentity(course, memberActive);
        if (identMsg) {
            perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: identMsg });
            continue;
        }

        // Guard: group phase1 window
        if (phase1Msg) {
            perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: phase1Msg });
            continue;
        }

        // ── Route by MV status ──
        if (mvCourseIds.has(sel.courseId)) {
            // MV course: pending_vote, no deduction, no order
            const { data: rpcResult, error: rpcError } = await adminClient.rpc('enroll_atomic', {
                p_user: user.id,
                p_course: sel.courseId,
                p_type: 'full',
                p_session: null,
                p_status: 'pending_vote',
                p_cards_to_deduct: 0,
                p_order_id: null,
            });

            if (rpcError) {
                perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: rpcError.message });
                continue;
            }

            const result = rpcResult as { ok: boolean; enrollment_id?: string; reason?: string };
            if (!result.ok) {
                if (result.reason === 'full') {
                    perCourse.push({ courseId: sel.courseId, status: 'full' });
                } else if (result.reason === 'already_enrolled') {
                    perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '已報名此課程' });
                } else {
                    perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: result.reason });
                }
                continue;
            }

            // Set wants_leader
            if (result.enrollment_id) {
                await adminClient.from('enrollments')
                    .update({ wants_leader: sel.wantsLeader })
                    .eq('id', result.enrollment_id);
            }

            // TODO [Task 6.2]: persist votes from sel.votes here
            // Vote-writing and vote-integrity guards are deferred to Task 6.2.

            perCourse.push({ courseId: sel.courseId, status: 'pending_vote' });
            continue;
        }

        // ── Route by pricing_mode ──
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sessions = (course.course_sessions as any[]) ?? [];
        const sessionCount = sessions.length;
        const pricingInputs = {
            pricing_mode: course.pricing_mode as import('@/types/database').PricingMode,
            cards_per_session: course.cards_per_session,
            price_member_single: course.price_member_single,
            price_guest_single: course.price_guest_single,
            price_member_full: course.price_member_full,
            price_guest_full: course.price_guest_full,
            sessionCount,
        };

        let price: import('@/lib/supabase/pricing').PriceResult;
        try {
            price = resolvePrice(pricingInputs, memberActive, 'full');
        } catch (e: unknown) {
            perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: e instanceof Error ? e.message : '定價錯誤' });
            continue;
        }

        if (price.kind === 'free') {
            // Free course: enroll immediately
            const { data: rpcResult, error: rpcError } = await adminClient.rpc('enroll_atomic', {
                p_user: user.id,
                p_course: sel.courseId,
                p_type: 'full',
                p_session: null,
                p_status: 'enrolled',
                p_cards_to_deduct: 0,
                p_order_id: null,
            });

            if (rpcError) {
                perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: rpcError.message });
                continue;
            }

            const result = rpcResult as { ok: boolean; enrollment_id?: string; reason?: string };
            if (!result.ok) {
                if (result.reason === 'full') { perCourse.push({ courseId: sel.courseId, status: 'full' }); }
                else if (result.reason === 'already_enrolled') { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '已報名此課程' }); }
                else { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: result.reason }); }
                continue;
            }

            if (result.enrollment_id) {
                await adminClient.from('enrollments').update({ wants_leader: sel.wantsLeader }).eq('id', result.enrollment_id);
            }
            perCourse.push({ courseId: sel.courseId, status: 'enrolled' });

        } else if (price.kind === 'card') {
            // Card course: check balance
            const { getAvailableCardBalance } = await import('@/lib/supabase/card-utils');

            // Get latest session date for expiry check
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sortedSessions = [...sessions].sort((a: any, b: any) =>
                (b.session_date as string).localeCompare(a.session_date as string));
            const latestSessionDate = sortedSessions[0]?.session_date ?? taipeiToday;

            const cardInfo = await getAvailableCardBalance(user.id, latestSessionDate);
            const cardsNeeded = price.cards;

            if (cardInfo.available >= cardsNeeded) {
                // Sufficient cards: enroll + deduct
                const { data: rpcResult, error: rpcError } = await adminClient.rpc('enroll_atomic', {
                    p_user: user.id,
                    p_course: sel.courseId,
                    p_type: 'full',
                    p_session: null,
                    p_status: 'enrolled',
                    p_cards_to_deduct: cardsNeeded,
                    p_order_id: null,
                });

                if (rpcError) {
                    perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: rpcError.message });
                    continue;
                }

                const result = rpcResult as { ok: boolean; enrollment_id?: string; reason?: string };
                if (!result.ok) {
                    if (result.reason === 'full') { perCourse.push({ courseId: sel.courseId, status: 'full' }); }
                    else if (result.reason === 'already_enrolled') { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '已報名此課程' }); }
                    else if (result.reason === 'insufficient_cards') { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '堂卡不足' }); }
                    else { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: result.reason }); }
                    continue;
                }

                if (result.enrollment_id) {
                    await adminClient.from('enrollments').update({ wants_leader: sel.wantsLeader }).eq('id', result.enrollment_id);
                }
                perCourse.push({ courseId: sel.courseId, status: 'enrolled' });

            } else if (payload.buyCards) {
                // Shortfall + buyCards: pending_payment enrollment + card order
                const { data: rpcResult, error: rpcError } = await adminClient.rpc('enroll_atomic', {
                    p_user: user.id,
                    p_course: sel.courseId,
                    p_type: 'full',
                    p_session: null,
                    p_status: 'pending_payment',
                    p_cards_to_deduct: 0,
                    p_order_id: null,
                });

                if (rpcError) {
                    perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: rpcError.message });
                    continue;
                }

                const result = rpcResult as { ok: boolean; enrollment_id?: string; reason?: string };
                if (!result.ok) {
                    if (result.reason === 'full') { perCourse.push({ courseId: sel.courseId, status: 'full' }); }
                    else if (result.reason === 'already_enrolled') { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '已報名此課程' }); }
                    else { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: result.reason }); }
                    continue;
                }

                if (result.enrollment_id) {
                    await adminClient.from('enrollments').update({ wants_leader: sel.wantsLeader }).eq('id', result.enrollment_id);
                    cardPendingEnrollmentIds.push(result.enrollment_id);
                }
                perCourse.push({ courseId: sel.courseId, status: 'pending_payment' });

            } else {
                // Shortfall and no buyCards: rejected
                perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '堂卡不足' });
            }

        } else if (price.kind === 'ntd') {
            // NTD course: pending_payment enrollment, collect for batch order
            const { data: rpcResult, error: rpcError } = await adminClient.rpc('enroll_atomic', {
                p_user: user.id,
                p_course: sel.courseId,
                p_type: 'full',
                p_session: null,
                p_status: 'pending_payment',
                p_cards_to_deduct: 0,
                p_order_id: null,
            });

            if (rpcError) {
                perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: rpcError.message });
                continue;
            }

            const result = rpcResult as { ok: boolean; enrollment_id?: string; reason?: string };
            if (!result.ok) {
                if (result.reason === 'full') { perCourse.push({ courseId: sel.courseId, status: 'full' }); }
                else if (result.reason === 'already_enrolled') { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: '已報名此課程' }); }
                else { perCourse.push({ courseId: sel.courseId, status: 'rejected', reason: result.reason }); }
                continue;
            }

            if (result.enrollment_id) {
                await adminClient.from('enrollments').update({ wants_leader: sel.wantsLeader }).eq('id', result.enrollment_id);
                ntdEnrollmentIds.push(result.enrollment_id);
            }
            ntdTotalAmount += price.amount;
            perCourse.push({ courseId: sel.courseId, status: 'pending_payment' });
        }
    }

    // ── 8. Create orders for pending_payment enrollments ──
    let orderId: string | undefined;
    let cardOrderId: string | undefined;

    // NTD: create a single course_fee order for all ntd enrollments
    if (ntdEnrollmentIds.length > 0 && ntdTotalAmount > 0) {
        const result = await createCourseFeeOrder({
            userId: user.id,
            courseGroupId: payload.groupId,
            amount: ntdTotalAmount,
            enrollmentIds: ntdEnrollmentIds,
        });
        orderId = result.orderId;
    }

    // Card shortfall: create a card_purchase order directly via adminClient.
    // We bypass createCardOrder() because that user-facing function enforces
    // purchase-window, quantity-unit and min-purchase validations that do not
    // apply when buying cards as part of group enrollment.
    if (cardPendingEnrollmentIds.length > 0 && payload.buyCards) {
        const { quantity, remittance } = payload.buyCards;
        const config = await getSystemConfig();
        const includeMembership = payload.includeMembership ?? false;
        const unitPrice = (memberActive || includeMembership)
            ? parseInt(config['card_price_member'] ?? '270', 10)
            : parseInt(config['card_price_non_member'] ?? '370', 10);
        const membershipPrice = includeMembership ? 1800 : 0;
        const totalAmount = (quantity * unitPrice) + membershipPrice;
        const expiresAt = groupValidUntil ?? `${taipeiToday.slice(0, 4)}-12-31`;

        const { data: cardOrder, error: cardOrderError } = await adminClient
            .from('orders')
            .insert({
                user_id: user.id,
                quantity,
                unit_price: unitPrice,
                total_amount: totalAmount,
                status: 'pending',
                include_membership: includeMembership,
                expires_at: expiresAt,
                order_type: 'card_purchase' as const,
                course_group_id: payload.groupId,
            })
            .select('id')
            .single();

        if (cardOrderError || !cardOrder) {
            throw new Error(`建立購卡訂單失敗: ${cardOrderError?.message ?? 'unknown'}`);
        }

        cardOrderId = cardOrder.id;

        // Submit remittance info if provided
        if (remittance) {
            await submitRemittanceInfo(
                cardOrder.id,
                remittance.bankCode,
                remittance.last5,
                remittance.remittanceDate,
                remittance.note,
            );
        }

        // Link card-pending enrollments to this card order
        await adminClient.from('enrollments')
            .update({ order_id: cardOrder.id })
            .in('id', cardPendingEnrollmentIds);
    }

    revalidatePath('/', 'layout');
    return { perCourse, orderId, cardOrderId };
}

// ------------------------------------------------------------------
// Modify Group Enrollment — resubmitGroupEnrollment (Task 5.4)
// ------------------------------------------------------------------

/**
 * Atomic void-and-rebook: cancel the member's prior full-term group
 * submission (release seats, refund deducted cards, cancel linked
 * pending/remitted orders) then re-run submitGroupEnrollment with the
 * new selections.
 *
 * REFUSES if any linked order is already confirmed (paid), leaving
 * the original submission fully intact.
 *
 * Atomicity: the void is a single Postgres RPC (void_group_submission)
 * so partial failure cannot strand seats or cards.  The re-enroll uses
 * enroll_atomic per course (same as submitGroupEnrollment).
 *
 * Idempotency: FOR UPDATE + conditional WHERE status IN (active) in
 * the RPC prevents a concurrent/repeated call from double-cancelling
 * or double-refunding.
 */
export async function resubmitGroupEnrollment(
    payload: GroupEnrollmentPayload
): Promise<{ success: false; message: string } | GroupEnrollmentResult> {
    const { user } = await getCurrentUser();
    const adminClient = createAdminClient();

    // ── 1. Atomically void the prior submission ──
    const { data: voidResult, error: voidError } = await adminClient.rpc('void_group_submission', {
        p_user: user.id,
        p_group_id: payload.groupId,
    });

    if (voidError) throw new Error(`作廢失敗: ${voidError.message}`);

    const vr = voidResult as { ok: boolean; reason?: string; voided?: number; refunded_cards?: number };

    if (!vr.ok) {
        if (vr.reason === 'confirmed_order') {
            return { success: false, message: '已有確認付款的訂單，無法作廢重報。請聯繫幹部處理。' };
        }
        if (vr.reason === 'no_active_submission') {
            return { success: false, message: '找不到目前的報名資料，無法作廢重報。' };
        }
        return { success: false, message: `作廢失敗: ${vr.reason}` };
    }

    // ── 2. Re-enroll with the new selections ──
    // submitGroupEnrollment handles auth, pricing, capacity, card deduction.
    // enroll_atomic sets enrolled_at = NOW(), guaranteeing a later timestamp
    // than the originals (which were created in an earlier transaction).
    return await submitGroupEnrollment(payload);
}
