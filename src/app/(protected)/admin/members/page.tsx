import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft, UserSquare } from "lucide-react";
import Link from 'next/link';
import { MembersClient } from '@/components/admin/members-client';

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.role !== 'admin') {
        redirect('/dashboard');
    }

    // Fetch all profiles
    const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, employee_id, role, member_valid_until, card_balance')
        .order('name', { ascending: true });

    // Fetch all course leaders with course info
    const { data: leaderData } = await supabase
        .from('course_leaders')
        .select(`
            user_id,
            courses ( name, course_groups ( title ) )
        `);

    // Build leader map: user_id -> [ { courseName, groupTitle } ]
    const leaderMap = new Map<string, { courseName: string; groupTitle: string }[]>();
    for (const ld of leaderData ?? []) {
        const course = ld.courses as any;
        if (!course) continue;
        const entry = {
            courseName: course.name,
            groupTitle: course.course_groups?.title || '',
        };
        const existing = leaderMap.get(ld.user_id) || [];
        existing.push(entry);
        leaderMap.set(ld.user_id, existing);
    }

    // Merge data
    const members = (profiles ?? []).map(p => ({
        id: p.id,
        name: p.name || '(未設定姓名)',
        employee_id: p.employee_id,
        role: p.role,
        member_valid_until: p.member_valid_until,
        card_balance: p.card_balance ?? 0,
        leader_courses: leaderMap.get(p.id) || [],
    }));

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
                            <p className="text-[13px] text-muted-foreground font-medium">
                                管理全體社員權限、會籍期限與基本資訊（共 {members.length} 人）
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <MembersClient members={members} />
        </div>
    );
}
