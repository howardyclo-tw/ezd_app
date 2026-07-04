/**
 * E2E Test-only API route.
 * Calls confirmOrder / cancelOrder with the caller's authenticated session.
 * Only available in development (NODE_ENV !== 'production').
 */
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
    }

    const body = await request.json();
    const { action, orderId, groupId, groupName, groupValidUntil,
            courseId, courseIds, sessionIds, sessionId, enrollType } = body;

    if (!action) {
        return NextResponse.json({ error: 'Missing action' }, { status: 400 });
    }

    try {
        // Dynamic import to avoid bundling in production
        const actions = await import('@/lib/supabase/actions');

        let result;
        if (action === 'confirmOrder') {
            if (!orderId) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
            result = await actions.confirmOrder(orderId);
        } else if (action === 'cancelOrder') {
            if (!orderId) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
            result = await actions.cancelOrder(orderId);
        } else if (action === 'rejectOrder') {
            if (!orderId) return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
            result = await actions.rejectOrder(orderId);
        } else if (action === 'updateMemberGroup') {
            if (!groupId || !groupName || !groupValidUntil) {
                return NextResponse.json({ error: 'Missing groupId, groupName, or groupValidUntil' }, { status: 400 });
            }
            result = await actions.updateMemberGroup(groupId, groupName, groupValidUntil);
        } else if (action === 'enrollInCourse') {
            if (!courseId) return NextResponse.json({ error: 'Missing courseId' }, { status: 400 });
            result = await actions.enrollInCourse(courseId, enrollType || 'full', sessionId);
        } else if (action === 'batchEnrollInCourses') {
            if (!courseIds || !Array.isArray(courseIds)) return NextResponse.json({ error: 'Missing courseIds array' }, { status: 400 });
            result = await actions.batchEnrollInCourses(courseIds);
        } else if (action === 'batchEnrollInSessions') {
            if (!courseId || !sessionIds || !Array.isArray(sessionIds)) return NextResponse.json({ error: 'Missing courseId or sessionIds' }, { status: 400 });
            result = await actions.batchEnrollInSessions(courseId, sessionIds);
        } else {
            return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
        }

        return NextResponse.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ success: false, message, error: message }, { status: 200 });
    }
}
