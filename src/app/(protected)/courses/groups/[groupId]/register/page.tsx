import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound, redirect } from 'next/navigation';
import { RegisterWizardClient } from './register-wizard-client';
import { isMemberActive } from '@/lib/supabase/pricing';
import { getTaipeiToday } from '@/lib/date';

export const dynamic = 'force-dynamic';

export default async function RegisterPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = await params;
    const supabase = await createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Fetch user profile with member_group
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, role, card_balance, member_valid_until, member_group_id, member_groups ( valid_until )')
        .eq('id', user.id)
        .maybeSingle();

    if (!profile) redirect('/login');

    // Resolve group by ID or slug
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId);
    const groupQuery = supabase.from('course_groups').select('*');
    if (isUuid) {
        groupQuery.or(`id.eq.${groupId},slug.eq.${groupId}`);
    } else {
        groupQuery.eq('slug', groupId);
    }
    const { data: groupData } = await groupQuery.maybeSingle();
    if (!groupData) notFound();

    // Auto-fix URL: if accessed via UUID but has a slug, redirect
    if (isUuid && groupData.slug && groupData.slug !== groupId) {
        redirect(`/courses/groups/${groupData.slug}/register`);
    }

    const adminDb = createAdminClient();

    // Fetch courses + sessions + polls + user enrollments in parallel
    const [
        { data: courses },
        { data: userEnrollments },
        { data: openPolls },
    ] = await Promise.all([
        adminDb
            .from('courses')
            .select(`
                id, name, description, teacher, room, type, capacity,
                cards_per_session, pricing_mode,
                price_member_single, price_guest_single,
                price_member_full, price_guest_full,
                enroll_full, enroll_single,
                enroll_full_identity, enroll_single_identity,
                enrollment_start_at, enrollment_end_at,
                start_time, end_time,
                course_sessions ( id, session_date, session_number )
            `)
            .eq('group_id', groupData.id),
        supabase
            .from('enrollments')
            .select('course_id, status')
            .eq('user_id', user.id)
            .eq('type', 'full')
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']),
        adminDb
            .from('course_polls')
            .select('id, course_id, title, vote_type, poll_options ( id, label, youtube_url, sort_order )')
            .eq('status', 'open'),
    ]);

    // Compute per-session occupancy for capacity check
    const allCourseIds = (courses ?? []).map(c => c.id);
    const allSessionIds = (courses ?? []).flatMap(c =>
        ((c.course_sessions as { id: string }[]) ?? []).map((s) => s.id)
    );

    const [
        { data: allEnrollments },
    ] = allSessionIds.length > 0 ? await Promise.all([
        adminDb.from('enrollments')
            .select('course_id, type, status, session_id')
            .in('status', ['enrolled', 'pending_payment', 'pending_vote'])
            .in('course_id', allCourseIds),
    ]) : [{ data: [] as { course_id: string; type: string; status: string }[] }];

    // Compute max occupancy per course
    const enrollmentsByCourse: Record<string, { course_id: string; type: string }[]> = {};
    (allEnrollments ?? []).forEach((e) => {
        if (!enrollmentsByCourse[e.course_id]) enrollmentsByCourse[e.course_id] = [];
        enrollmentsByCourse[e.course_id].push(e);
    });

    const courseMaxOccupancy: Record<string, number> = {};
    for (const course of (courses ?? [])) {
        const courseEnrollments = enrollmentsByCourse[course.id] ?? [];
        // For group enrollment, full-count is the dominant occupancy metric
        const fullCount = courseEnrollments.filter((e) => e.type === 'full').length;
        courseMaxOccupancy[course.id] = fullCount;
    }

    // Build poll map: courseId -> poll with options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pollMap: Record<string, any> = {};
    for (const poll of (openPolls ?? [])) {
        pollMap[poll.course_id] = poll;
    }

    // Enrolled course IDs (already enrolled/pending)
    const enrolledCourseIds = new Set(
        (userEnrollments ?? []).map(e => e.course_id)
    );

    // Compute member status for identity-gated enrollment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupValidUntil = (profile.member_groups as any)?.valid_until ?? null;
    const taipeiToday = getTaipeiToday();
    const userIsMember = isMemberActive(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: profile.role as any, member_valid_until: profile.member_valid_until ?? null, groupValidUntil },
        taipeiToday
    );

    // Map courses to client-friendly data
    const coursesForClient = (courses ?? []).map(c => {
        const sessions = ((c.course_sessions as Array<{ session_date: string }>) ?? []).sort(
            (a, b) => a.session_date.localeCompare(b.session_date)
        );
        const poll = pollMap[c.id] ?? null;
        const isMv = !!poll;
        const occupancy = courseMaxOccupancy[c.id] ?? 0;
        const isFull = occupancy >= c.capacity;
        const isEnrolled = enrolledCourseIds.has(c.id);
        const identityLocked = c.enroll_full_identity === 'member' && !userIsMember;
        const canEnrollFull = c.enroll_full !== false && !identityLocked;

        // Determine pricing badge
        let pricingBadge: string;
        if (c.pricing_mode === 'free') {
            pricingBadge = '免費';
        } else if (c.pricing_mode === 'ntd') {
            pricingBadge = 'NTD';
        } else {
            pricingBadge = '堂卡';
        }

        return {
            id: c.id,
            name: c.name,
            teacher: c.teacher,
            room: c.room,
            type: c.type,
            capacity: c.capacity,
            occupancy,
            sessionsCount: sessions.length,
            cardsPerSession: c.cards_per_session,
            pricingMode: c.pricing_mode,
            priceMemberFull: c.price_member_full,
            priceGuestFull: c.price_guest_full,
            enrollFull: c.enroll_full,
            isFull,
            isEnrolled,
            isMv,
            pricingBadge,
            canEnrollFull,
            identityLocked,
            startTime: c.start_time,
            endTime: c.end_time,
            firstSessionDate: sessions[0]?.session_date ?? '',
            poll: poll ? {
                id: poll.id,
                title: poll.title,
                voteType: poll.vote_type,
                options: ((poll.poll_options as Array<{ id: string; label: string; youtube_url: string | null; sort_order: number }>) ?? [])
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((o) => ({
                        id: o.id,
                        label: o.label,
                        youtubeUrl: o.youtube_url,
                    })),
            } : null,
        };
    }).sort((a, b) => {
        // Sort by day-of-week then start time
        const dayA = a.firstSessionDate ? (new Date(a.firstSessionDate + 'T00:00:00').getDay() || 7) : 8;
        const dayB = b.firstSessionDate ? (new Date(b.firstSessionDate + 'T00:00:00').getDay() || 7) : 8;
        if (dayA !== dayB) return dayA - dayB;
        if (a.startTime !== b.startTime) return (a.startTime ?? '').localeCompare(b.startTime ?? '');
        return a.name.localeCompare(b.name);
    });

    return (
        <RegisterWizardClient
            groupId={groupData.id}
            groupTitle={groupData.title}
            courses={coursesForClient}
            cardBalance={profile.card_balance}
            userRole={profile.role}
            groupSlug={groupData.slug || groupData.id}
        />
    );
}
