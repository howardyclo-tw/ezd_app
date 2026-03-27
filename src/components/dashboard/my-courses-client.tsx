'use client';

import { createClient } from '@/lib/supabase/server';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList, Calendar, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { SessionCard, type SessionCardProps } from '@/components/courses/session-card';

interface MyCoursesClientProps {
    upcomingSessions: SessionCardProps[];
    historyRecords: SessionCardProps[];
    makeupGroups: { id: string, title: string, count: number, href: string }[];
    availableMakeupQuotaCount: number;
    manualQuota: number;
}

export function MyCoursesClient({ upcomingSessions, historyRecords, makeupGroups, availableMakeupQuotaCount, manualQuota }: MyCoursesClientProps) {
    const [tab, setTab] = useState('upcoming');

    const currentList = tab === 'upcoming'
        ? upcomingSessions
        : tab === 'history'
            ? historyRecords
            : []; // makeup tab handled separately below

    const emptyMessages: Record<string, { title: string; desc: string }> = {
        upcoming: { title: '沒有即將到來的課程', desc: '目前沒有已報名的未來課堂。' },
        history: { title: '尚無出席紀錄', desc: '您還沒有任何出席紀錄。' },
        makeup: { title: '沒有可用的補課額度', desc: '目前沒有符合補課條件的缺席紀錄。' },
    };

    return (
        <>
            {/* Filter Tabs */}
            <div className="flex justify-center px-4 sm:px-0">
                <Tabs defaultValue="upcoming" className="w-full sm:w-auto" onValueChange={setTab}>
                    <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 flex w-max mx-auto overflow-x-auto no-scrollbar sm:w-auto">
                        <TabsTrigger value="upcoming" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            即將到來 ({upcomingSessions.length})
                        </TabsTrigger>
                        <TabsTrigger value="makeup" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            可用補課 ({availableMakeupQuotaCount})
                        </TabsTrigger>
                        <TabsTrigger value="history" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            歷史紀錄
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Content */}
            {tab === 'makeup' ? (
                makeupGroups.length === 0 ? (
                    <Card className="border-dashed border-muted/50 bg-muted/5">
                        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                                <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                            <h3 className="text-lg font-bold text-foreground/80">{emptyMessages.makeup.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1 px-4 max-w-xs mx-auto">
                                {emptyMessages.makeup.desc}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 grid-cols-1">

                        {makeupGroups.map((group) => (
                            <Link href={group.href} key={group.id} className="block w-full no-underline">
                                <Card className="border-border/40 shadow-sm transition-all duration-200 overflow-hidden w-full bg-card/50 backdrop-blur-sm hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 active:scale-[0.98] group cursor-pointer relative transform-gpu backface-hidden">
                                    <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4 w-full">
                                        <div className="flex items-center gap-4 min-w-0 flex-1">
                                            <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0 group-hover:scale-110 transition-transform">
                                                <Calendar className="h-6 w-6" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-[15px] sm:text-base leading-tight truncate text-foreground tracking-tight group-hover:text-primary transition-colors">
                                                    {group.title}
                                                </h3>
                                                <p className="text-[12px] sm:text-[13px] text-muted-foreground font-medium mt-1">
                                                    共有 <span className="text-orange-500 font-bold">{group.count}</span> 堂課可以補
                                                </p>
                                            </div>
                                        </div>
                                        <div className="shrink-0 flex items-center justify-end gap-2 ml-auto">
                                            <div className="flex items-center gap-0.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight transition-all bg-orange-500/10 border border-orange-500/30 text-orange-500 shadow-sm group-hover:bg-orange-500/20 group-hover:border-orange-500/50">
                                                <span>找課補</span>
                                                <ArrowRight className="h-3.5 w-3.5" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                )
            ) : currentList.length === 0 ? (
                <Card className="border-dashed border-muted/50 bg-muted/5">
                    <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                            <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
                        </div>
                        <h3 className="text-lg font-bold text-foreground/80">{emptyMessages[tab]?.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1 px-4 max-w-xs mx-auto">
                            {emptyMessages[tab]?.desc}
                        </p>
                        {tab === 'upcoming' && (
                            <Button className="mt-8 font-bold bg-primary text-primary-foreground shadow-lg px-8 rounded-xl" asChild>
                                <Link href="/courses">前往探索課程</Link>
                            </Button>
                        )}
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3 grid-cols-1">
                    {currentList.map((session, idx) => (
                        <SessionCard key={`${session.date}-${session.sessionNumber}-${session.courseName}-${idx}`} {...session} />
                    ))}
                </div>
            )}
        </>
    );
}
