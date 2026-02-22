import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, Users, Clock, MapPin, ChevronRight, ClipboardCheck, Crown } from "lucide-react";
import Link from 'next/link';
import { format } from 'date-fns';
import { cn } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default async function LeaderRollcallPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Get profile and check role
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    const isAdmin = profile?.role === 'admin';
    const isLeader = profile?.role === 'leader';

    if (!isAdmin && !isLeader) {
        redirect('/dashboard');
    }

    // Get today's date in YYYY-MM-DD
    const today = format(new Date(), 'yyyy-MM-dd');

    // Fetch sessions for today with leader names and group titles
    const { data: sessions, error } = await supabase
        .from('course_sessions')
        .select(`
            id,
            session_date,
            session_number,
            courses (
                id,
                name,
                teacher,
                room,
                start_time,
                end_time,
                slug,
                course_groups ( id, slug, title ),
                course_leaders ( user_id, profiles!course_leaders_user_id_fkey ( name ) )
            )
        `)
        .eq('session_date', today);

    if (error) {
        console.error('Error fetching today sessions:', error);
    }

    // Filter sessions: 
    // If admin, keep all. 
    // If leader, keep only those where user is in course_leaders.
    const mySessions = (sessions ?? []).filter((s: any) => {
        if (isAdmin) return true;
        const leaders = s.courses?.course_leaders || [];
        return leaders.some((l: any) => l.user_id === user.id);
    });

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground">
                        <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <ClipboardCheck className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">今日點名</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">
                                {format(new Date(), 'yyyy/MM/dd')} 共 {mySessions.length} 堂課
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            {mySessions.length === 0 ? (
                <Card className="border-dashed border-muted/50 bg-muted/5">
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                            <ClipboardCheck className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                        <h3 className="text-lg font-bold text-foreground/80">今天沒有點名任務</h3>
                        <p className="text-sm text-muted-foreground mt-1 px-4">
                            當前日期下（{today}）沒有您負責的課程。
                        </p>
                        <Button variant="outline" className="mt-6 font-bold" asChild>
                            <Link href="/courses">查看所有課程</Link>
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                    {mySessions.map((session: any) => {
                        const course = session.courses;
                        const group = course.course_groups;
                        const gShortId = group?.slug || group?.id;
                        const cShortId = course.slug || course.id;

                        // Determine leader info
                        const leaders = course.course_leaders || [];
                        const isMyClass = leaders.some((l: any) => l.user_id === user.id);
                        const leaderNames = leaders
                            .map((l: any) => l.profiles?.name ?? '未知')
                            .join('、');

                        return (
                            <Link key={session.id} href={`/courses/groups/${gShortId}/${cShortId}?sessionId=${session.id}`}>
                                <Card className={cn(
                                    "border-border/40 shadow-sm hover:shadow-md transition-all hover:border-primary/20 active:scale-[0.99] group overflow-hidden bg-card/50 backdrop-blur-sm",
                                    isMyClass && "border-primary/30 bg-primary/[0.02]"
                                )}>
                                    <CardContent className="p-5 flex items-center justify-between gap-4">
                                        <div className="flex-1 min-w-0 space-y-3">
                                            <div>
                                                {/* Group Title Tag */}
                                                {group?.title && (
                                                    <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 mb-1.5">
                                                        {group.title}
                                                    </p>
                                                )}
                                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] font-bold uppercase tracking-wider text-primary border-primary/20 bg-primary/5"
                                                    >
                                                        第 {session.session_number} 堂
                                                    </Badge>
                                                    {isMyClass && (
                                                        <Badge variant="secondary" className="text-[10px] font-black bg-primary/10 text-primary border-none gap-1">
                                                            <Crown className="h-2.5 w-2.5" />
                                                            你是此班班長
                                                        </Badge>
                                                    )}
                                                </div>
                                                <h3 className="font-bold text-base leading-tight truncate text-foreground tracking-tight group-hover:text-primary transition-colors">
                                                    {course.teacher} {course.name}
                                                </h3>
                                            </div>

                                            <div className="flex flex-col gap-1.5 pb-1">
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                                                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                                    <span>{course.start_time?.slice(0, 5)}~{course.end_time?.slice(0, 5)}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
                                                    <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                                    <span className="truncate">{course.room}</span>
                                                </div>
                                                {/* Show leader names for admin */}
                                                {isAdmin && leaderNames && (
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                                                        <Crown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                                        <span className="truncate">班長：{leaderNames}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="shrink-0 h-10 w-10 rounded-full bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-background transition-all">
                                            <ChevronRight className="h-5 w-5" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
