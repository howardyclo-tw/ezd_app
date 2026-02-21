import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, ShieldCheck, Check, X, Clock, User, Calendar } from "lucide-react";
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { reviewLeaveRequest, reviewMakeupRequest, reviewTransferRequest } from '@/lib/supabase/actions';
import { ApprovalsList } from '@/components/leader/approvals-list';

export const dynamic = 'force-dynamic';

export default async function LeaderApprovalsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.role !== 'admin' && profile?.role !== 'leader') {
        redirect('/dashboard');
    }

    const isAdmin = profile?.role === 'admin';

    // Fetch Leave Requests (Pending)
    const { data: leaveRequests } = await supabase
        .from('leave_requests')
        .select(`
            *,
            profiles!leave_requests_user_id_fkey(name),
            courses(name),
            course_sessions(session_date, session_number)
        `)
        .eq('status', 'pending');

    // Fetch Makeup Requests (Pending)
    const { data: makeupRequests } = await supabase
        .from('makeup_requests')
        .select(`
            *,
            profiles!makeup_requests_user_id_fkey(name),
            original_courses:original_course_id(name),
            target_courses:target_course_id(name),
            target_sessions:target_session_id(session_date, session_number)
        `)
        .eq('status', 'pending');

    // Fetch Transfer Requests (Pending)
    const { data: transferRequests } = await supabase
        .from('transfer_requests')
        .select(`
            *,
            from_profile:from_user_id(name),
            to_profile:to_user_id(name),
            courses(name),
            course_sessions(session_date, session_number)
        `)
        .eq('status', 'pending');

    // Combine and format for UI
    const allApprovals = [
        ...(leaveRequests || []).map(r => ({ ...r, type: 'leave' })),
        ...(makeupRequests || []).map(r => ({ ...r, type: 'makeup' })),
        ...(transferRequests || []).map(r => ({ ...r, type: 'transfer' }))
    ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-9 w-9 -ml-2 shrink-0">
                        <Link href="/dashboard"><ChevronLeft className="h-5 w-5" /></Link>
                    </Button>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight leading-tight">申請審核</h1>
                        <p className="text-sm text-muted-foreground font-medium mt-0.5">
                            處理待確認的請假、補課及轉讓申請
                        </p>
                    </div>
                </div>
            </div>

            <ApprovalsList initialApprovals={allApprovals} isAdmin={isAdmin} currentUserId={user.id} />
        </div>
    );
}
