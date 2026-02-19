'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Clock, MapPin, ChevronRight, Calendar } from "lucide-react";
import Link from 'next/link';

import { cn } from "@/lib/utils";

interface CourseProps {
    id: string;
    name: string;
    teacher: string;
    time: string;
    location: string;
    type: string; // 'trial', 'regular', 'workshop'
    status: string; // 'open', 'full', 'upcoming', 'ended'
    price?: number;
    capacity?: number;
    // Management additions
    isManagement?: boolean;
    userStatus?: string; // 'enrolled', 'waitlist', 'leave', 'transferred_out', 'transferred_in', 'ended'
    waitingNo?: number;
    progress?: string;
}

const statusMap: Record<string, { label: string, color: string, variant: "default" | "secondary" | "outline" | "ghost" }> = {
    open: { label: '報名', color: 'bg-primary text-primary-foreground hover:bg-primary/90', variant: 'default' },
    full: { label: '額滿', color: 'bg-muted text-muted-foreground', variant: 'secondary' },
    upcoming: { label: '未開放', color: 'bg-blue-500 text-white hover:bg-blue-600', variant: 'default' },
    ended: { label: '停課', color: 'bg-muted text-muted-foreground', variant: 'secondary' },

    // Legacy support
    published: { label: '報名', color: 'bg-primary', variant: 'default' },
    draft: { label: '草稿', color: 'bg-muted', variant: 'secondary' },
    closed: { label: '已結束', color: 'bg-muted', variant: 'secondary' },
};

const userStatusMap: Record<string, { label: string, color: string }> = {
    enrolled: { label: '已報名', color: 'bg-green-500/10 text-green-600 ring-green-600/20' },
    waitlist: { label: '候補中', color: 'bg-orange-500/10 text-orange-600 ring-orange-600/20' },
    leave: { label: '已請假', color: 'bg-blue-500/10 text-blue-600 ring-blue-600/20' },
    transferred_out: { label: '已轉出', color: 'bg-slate-500/10 text-slate-500 ring-slate-500/20' },
    transferred_in: { label: '已轉入', color: 'bg-purple-500/10 text-purple-600 ring-purple-600/20' },
    ended: { label: '已結束', color: 'bg-slate-500/10 text-slate-500 ring-slate-500/20' },
};

function stringToColor(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + "00000".substring(0, 6 - c.length) + c;
}

export function CourseCard({ course }: { course: CourseProps }) {
    const status = statusMap[course.status] || statusMap['open'];
    const userStatus = course.userStatus ? (userStatusMap[course.userStatus] || userStatusMap['enrolled']) : null;
    const avatarColor = stringToColor(course.teacher);

    // If waitlist, show "候補N" instead of "候補中"
    const displayLabel = (course.userStatus === 'waitlist' && course.waitingNo)
        ? `候補${course.waitingNo}`
        : (userStatus?.label || status.label);

    return (
        <Link href={`/courses/${course.id}`} className="block w-full">
            <Card className="border-border/40 shadow-sm hover:shadow-md transition-all hover:border-primary/20 active:scale-[0.99] group overflow-hidden w-full">
                <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4 w-full">
                    {/* Left & Middle Container */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Left: Avatar */}
                        <div className="shrink-0">
                            <div
                                className="h-11 w-11 sm:h-12 sm:w-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-sm ring-1 ring-white/10"
                                style={{ backgroundColor: avatarColor }}
                            >
                                {course.teacher.charAt(0)}
                            </div>
                        </div>

                        {/* Middle: Content */}
                        <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-[15px] sm:text-base leading-tight truncate mb-1 text-foreground">
                                {course.teacher} {course.name}
                            </h3>

                            <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground/90 truncate">
                                <Clock className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                <span className="truncate">{course.time}</span>
                            </div>

                            <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground/90 font-medium truncate mt-0.5">
                                <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                <span className="truncate">{course.teacher}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right Area: Status / Action */}
                    <div className="shrink-0 flex items-center justify-end min-w-[72px] ml-auto pl-2">
                        {course.isManagement ? (
                            <Badge
                                variant="outline"
                                className={cn(
                                    "rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider min-w-[62px] justify-center shadow-none border-transparent",
                                    userStatus?.color
                                )}
                            >
                                {displayLabel}
                            </Badge>
                        ) : (
                            <div className={`h-8 px-4 flex items-center justify-center text-xs font-bold rounded-full transition-colors shrink-0 ${course.status === 'open' ? 'bg-[#f3f4f6] text-[#111827] hover:bg-[#e5e7eb]' :
                                    'bg-muted text-muted-foreground'
                                } ${course.status === 'full' || course.status === 'ended' ? 'opacity-70' : ''}`}>
                                {status.label}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
