'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, Calendar, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from 'next/link';

function stringToColor(str: string) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + "00000".substring(0, 6 - c.length) + c;
}

export interface SessionCardProps {
    groupTitle: string;
    courseName: string;
    teacher: string;
    date: string;            // e.g. "2026-03-05"
    time?: string;           // e.g. "19:30~21:30" (only for upcoming)
    room?: string;
    sessionNumber: number;
    status: 'enrolled' | 'waitlist' | 'present' | 'absent' | 'leave' | 'available' | 'makeup_pending';
    waitlistPosition?: number;
    href?: string;           // Optional link to course detail
}

const statusConfig: Record<string, { label: string; color: string }> = {
    enrolled: { label: '已報名', color: 'bg-green-500/10 text-green-600 ring-green-600/20' },
    waitlist: { label: '候補', color: 'bg-orange-500/10 text-orange-600 ring-orange-600/20' },
    present: { label: '出席', color: 'bg-green-500/10 text-green-600 ring-green-600/20' },
    absent: { label: '缺席', color: 'bg-red-500/10 text-red-600 ring-red-600/20' },
    leave: { label: '請假', color: 'bg-blue-500/10 text-blue-600 ring-blue-600/20' },
    available: { label: '找課補', color: 'bg-orange-500/10 border border-orange-500/30 text-orange-500 shadow-sm hover:bg-orange-500/20 hover:border-orange-500/50' },
};

function formatDate(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const w = weekdays[d.getDay()];
    return `${m}/${day} (${w})`;
}

export function SessionCard({
    groupTitle, courseName, teacher, date, time, room,
    sessionNumber, status, waitlistPosition, href
}: SessionCardProps) {
    const avatarColor = stringToColor(teacher);
    const config = statusConfig[status] || statusConfig['enrolled'];
    const label = status === 'waitlist' && waitlistPosition
        ? `候補 ${waitlistPosition}`
        : config.label;

    const content = (
        <Card className={cn(
            "border-border/40 shadow-sm transition-all duration-200 overflow-hidden w-full bg-card/50 backdrop-blur-sm relative transform-gpu backface-hidden",
            href ? "hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 active:scale-[0.98] group cursor-pointer" : ""
        )}>
            {/* Tag at top left */}
            {groupTitle && (
                <div className="absolute top-0 left-0 bg-muted/50 text-muted-foreground px-2 py-0.5 rounded-br-lg text-[9px] font-bold tracking-wider z-10 border-b border-r border-border/10 backdrop-blur-sm">
                    {groupTitle}
                </div>
            )}
            <CardContent className="p-4 sm:p-5 pt-7 sm:pt-8 flex items-center justify-between gap-4 w-full">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Left: Teacher Avatar */}
                    <div className="shrink-0">
                        <div
                            className="h-11 w-11 sm:h-12 sm:w-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-sm ring-1 ring-white/10"
                            style={{ backgroundColor: avatarColor }}
                        >
                            {teacher.charAt(0)}
                        </div>
                    </div>

                    {/* Middle: Content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                            <h3 className={cn(
                                "font-bold text-[15px] sm:text-base leading-tight truncate text-foreground tracking-tight transition-colors",
                                href ? "group-hover:text-primary" : ""
                            )}>
                                {teacher} {courseName}
                            </h3>
                        </div>

                        {/* Metadata Row 1: Time & Session */}
                        <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground leading-none mb-1.5">
                            <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            <span className="truncate">
                                {formatDate(date)} {time ? time : ''} • 第 {sessionNumber} 堂
                            </span>
                        </div>

                        {/* Metadata Row 2: Location */}
                        {room && (
                            <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground/80 font-medium leading-none">
                                <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                <span className="truncate">{room}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Area: Status or Action */}
                <div className="shrink-0 flex items-center justify-end gap-4 ml-auto">
                    {/* Divider */}
                    <div className="h-8 w-[1px] bg-muted/40" />

                    <div className="flex items-center justify-center min-w-[70px]">
                        {status === 'available' ? (
                            <div className={cn(
                                "flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight transition-all",
                                config.color
                            )}>
                                <span>找課補</span>
                                <ChevronRight className="h-3.5 w-3.5" />
                            </div>
                        ) : (
                            <Badge
                                variant="outline"
                                className={cn(
                                    "rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider min-w-[62px] justify-center shadow-none border-transparent",
                                    config.color
                                )}
                            >
                                {label}
                            </Badge>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );

    if (href) {
        return (
            <Link href={href} className="block w-full no-underline">
                {content}
            </Link>
        );
    }

    return content;
}
