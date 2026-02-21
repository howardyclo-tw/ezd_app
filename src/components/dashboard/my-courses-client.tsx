'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { SessionCard, type SessionCardProps } from '@/components/courses/session-card';

interface MyCoursesClientProps {
    upcomingSessions: SessionCardProps[];
    historyRecords: SessionCardProps[];
    makeupSessions: SessionCardProps[];
}

export function MyCoursesClient({ upcomingSessions, historyRecords, makeupSessions }: MyCoursesClientProps) {
    const [tab, setTab] = useState('upcoming');

    const currentList = tab === 'upcoming'
        ? upcomingSessions
        : tab === 'history'
            ? historyRecords
            : makeupSessions;

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
                    <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 w-full grid grid-cols-3 sm:flex sm:grid-cols-none sm:w-auto">
                        <TabsTrigger value="upcoming" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            即將到來 ({upcomingSessions.length})
                        </TabsTrigger>
                        <TabsTrigger value="makeup" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            可用補課 ({makeupSessions.length})
                        </TabsTrigger>
                        <TabsTrigger value="history" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            歷史紀錄
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Content */}
            {currentList.length === 0 ? (
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
