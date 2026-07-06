import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound, redirect } from 'next/navigation';
import { RegisterWizardClient } from './register-wizard-client';
import { isMemberActive } from '@/lib/supabase/pricing';
import { getTaipeiToday, formatTaipeiDateTime } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { ChevronLeft, CalendarOff } from 'lucide-react';
import Link from 'next/link';

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

    const gSlug = groupData.slug || groupData.id;

    // Check registration window — render closed states instead of bare errors
    const now = new Date();
    const hasWindow = !!(groupData.registration_phase1_start && groupData.registration_phase1_end);
    const windowStart = hasWindow ? new Date(groupData.registration_phase1_start!) : null;
    const windowEnd = hasWindow ? new Date(groupData.registration_phase1_end!) : null;

    if (!hasWindow) {
        return (
            <div className="container max-w-2xl mx-auto py-16 text-center space-y-4">
                <CalendarOff className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <h2 className="text-xl font-bold">報名時段尚未設定</h2>
                <p className="text-muted-foreground text-sm">此檔期的報名時段尚未開放，請稍後再來。</p>
                <Button variant="outline" asChild>
                    <Link href={`/courses/groups/${gSlug}`}>
                        <ChevronLeft className="h-4 w-4 mr-1" />返回檔期頁面
                    </Link>
                </Button>
            </div>
        );
    }

    if (now < windowStart!) {
        return (
            <div className="container max-w-2xl mx-auto py-16 text-center space-y-4">
                <CalendarOff className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <h2 className="text-xl font-bold">整期報名尚未開放</h2>
                <p className="text-muted-foreground text-sm">
                    報名將於 {formatTaipeiDateTime(groupData.registration_phase1_start!)} 開放
                </p>
                <Button variant="outline" asChild>
                    <Link href={`/courses/groups/${gSlug}`}>
                        <ChevronLeft className="h-4 w-4 mr-1" />返回檔期頁面
                    </Link>
                </Button>
            </div>
        );
    }

    if (now > windowEnd!) {
        return (
            <div className="container max-w-2xl mx-auto py-16 text-center space-y-4">
                <CalendarOff className="h-12 w-12 mx-auto text-muted-foreground/40" />
                <h2 className="text-xl font-bold">整期報名已截止</h2>
                <p className="text-muted-foreground text-sm">
                    報名已於 {formatTaipeiDateTime(groupData.registration_phase1_end!)} 截止。如需單堂加報，請至各課程頁操作。
                </p>
                <Button variant="outline" asChild>
                    <Link href={`/courses/groups/${gSlug}`}>
                        <ChevronLeft className="h-4 w-4 mr-1" />返回檔期頁面
                    </Link>
                </Button>
            </div>
        );
    }

    const adminDb = createAdminClient();

    // Fetch courses + sessions + polls + user enrollments + purchase unit in parallel
    const [
        { data: courses },
        { data: userEnrollments },
        { data: openPolls },
        { data: purchaseUnitRow },
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
            .select('course_id, status, courses!enrollments_course_id_fkey ( name, group_id )')
            .eq('user_id', user.id)
            .eq('type', 'full')
            .in('status', ['enrolled', 'pending_payment', 'pending_vote']),
        adminDb
            .from('course_polls')
            .select('id, course_id, title, vote_type, poll_options ( id, label, youtube_url, sort_order )')
            .eq('status', 'open'),
        adminDb
            .from('system_config')
            .select('value')
            .eq('key', 'card_purchase_unit')
            .maybeSingle(),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groupEnrollments = (userEnrollments ?? []).filter((e: any) => e.courses?.group_id === groupData.id);

    const enrolledCourseIds = new Set(
        groupEnrollments.map(e => e.course_id)
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingEnrollments = groupEnrollments.map((e: any) => ({
        courseId: e.course_id as string,
        courseName: (e.courses?.name ?? '') as string,
        status: e.status as string,
    }));

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
            pricingBadge = '現金';
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

    const purchaseUnit = parseInt(purchaseUnitRow?.value ?? '5', 10) || 5;

    return (
        <RegisterWizardClient
            groupId={groupData.id}
            groupTitle={groupData.title}
            courses={coursesForClient}
            cardBalance={profile.card_balance}
            userRole={profile.role}
            groupSlug={groupData.slug || groupData.id}
            existingEnrollments={existingEnrollments}
            purchaseUnit={purchaseUnit}
            isMember={userIsMember}
        />
    );
}
