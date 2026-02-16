'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronRight } from "lucide-react";
import Link from 'next/link';
import { cn } from "@/lib/utils";

interface CourseGroupProps {
    id: string;
    title: string;
    period: string;
    status: string; // 'active', 'upcoming', 'ended'
    courseCount: number;
}

const STATUS_MAP = {
    active: { label: '進行中', color: 'bg-green-500/10 text-green-600 ring-green-600/20', barColor: 'bg-green-500' },
    upcoming: { label: '即將開始', color: 'bg-blue-500/10 text-blue-600 ring-blue-600/20', barColor: 'bg-blue-500' },
    ended: { label: '已結束', color: 'bg-slate-500/10 text-slate-600 ring-slate-600/20', barColor: 'bg-slate-300' },
};

export function CourseGroupCard({ group }: { group: CourseGroupProps }) {
    const statusInfo = STATUS_MAP[group.status as keyof typeof STATUS_MAP] || STATUS_MAP.ended;

    return (
        <Link href={`/courses/groups/${group.id}`} className="block">
            <Card className="hover:border-primary/40 transition-all hover:shadow-lg cursor-pointer group relative overflow-hidden border-muted/60 bg-card/50 backdrop-blur-sm">
                {/* Left Status Bar */}
                <div className={cn("absolute top-0 bottom-0 left-0 w-1", statusInfo.barColor)} />

                <CardContent className="p-5 pl-7 flex flex-row items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2.5 mb-1">
                            <Badge variant="outline" className={cn("rounded-sm px-1.5 py-0 text-[10px] ring-1 ring-inset border-transparent font-black uppercase tracking-wider", statusInfo.color)}>
                                {statusInfo.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                <Calendar className="h-3 w-3" /> {group.period}
                            </span>
                        </div>
                        <h3 className="font-bold text-lg group-hover:text-primary transition-colors leading-tight">
                            {group.title}
                        </h3>
                        <p className="text-sm text-muted-foreground font-medium">
                            {group.courseCount} 堂課程
                        </p>
                    </div>
                    <div className="flex items-center justify-end">
                        <div className="h-10 w-10 rounded-full flex items-center justify-center text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-all transform group-hover:translate-x-1">
                            <ChevronRight className="h-6 w-6" />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
