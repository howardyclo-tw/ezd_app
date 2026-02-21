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
    type: string;
    status: string;
    price?: number;
    capacity?: number;
    enrolledCount?: number;
    isManagement?: boolean;
    userStatus?: string;
    waitingNo?: number;
    progress?: string;
    href?: string;
}

const statusMap: Record<string, { label: string, color: string, variant: "default" | "secondary" | "outline" | "ghost" }> = {
    open: { label: '報名', color: 'bg-primary text-primary-foreground hover:bg-primary/90', variant: 'default' },
    full: { label: '額滿', color: 'bg-muted text-muted-foreground', variant: 'secondary' },
    upcoming: { label: '未開放', color: 'bg-blue-500 text-white hover:bg-blue-600', variant: 'default' },
    ended: { label: '停課', color: 'bg-muted text-muted-foreground', variant: 'secondary' },
    published: { label: '報名', color: 'bg-primary', variant: 'default' },
    draft: { label: '草稿', color: 'bg-muted', variant: 'secondary' },
    closed: { label: '已結束', color: 'bg-muted', variant: 'secondary' },
};

// Helper: compute course status for display
export function getCourseDisplayStatus(course: any): string {
    if (course.status === 'closed') return 'ended';
    if (course.status === 'draft') return 'upcoming';

    const now = new Date();
    const enrollStart = course.enrollment_start_at ? new Date(course.enrollment_start_at) : null;
    const enrollEnd = course.enrollment_end_at ? new Date(course.enrollment_end_at) : null;

    if (enrollStart && enrollStart > now) return 'upcoming';
    if (enrollEnd && enrollEnd < now) return 'ended';

    const enrolledCount = (course.enrollments as any[])?.[0]?.count ?? 0;
    if (enrolledCount >= course.capacity) return 'full';
    return 'open';
}

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

    return (
        <Link href={course.href || `/courses/${course.id}`} className="block w-full">
            <Card className="border-border/40 shadow-sm transition-all duration-200 overflow-hidden w-full bg-card/50 backdrop-blur-sm relative transform-gpu backface-hidden hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 active:scale-[0.98] group">
                <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4 w-full">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                        {/* Left: Teacher Avatar (Unify with My Courses) */}
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
                            <h3 className="font-bold text-[15px] sm:text-base leading-tight truncate mb-1.5 text-foreground tracking-tight group-hover:text-primary transition-colors">
                                {course.teacher} {course.name}
                            </h3>

                            {/* Unified Metadata Row 1: Time Only */}
                            <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground leading-none mb-1.5">
                                <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                <span className="truncate">{course.time}</span>
                            </div>

                            {/* Unified Metadata Row 2: Location (Replaces Teacher User Icon) */}
                            <div className="flex items-center gap-1.5 text-[12px] sm:text-[13px] text-muted-foreground/80 font-medium leading-none">
                                <MapPin className="h-3.5 w-3.5 shrink-0 opacity-60" />
                                <span className="truncate">{course.location}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right Area: Capacity Ring */}
                    {/* Right Area: Simple Text Capacity (Matching Dashboard style) */}
                    <div className="shrink-0 flex items-center justify-end gap-4 sm:gap-8 ml-auto">
                        {/* Divider */}
                        <div className="h-8 w-[1px] bg-muted/40" />

                        <div className="flex flex-col items-center min-w-[60px]">
                            {course.isManagement ? (
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-wider min-w-[62px] justify-center shadow-none border-transparent",
                                        userStatus?.color
                                    )}
                                >
                                    {(course.userStatus === 'waitlist' && course.waitingNo) ? `候補${course.waitingNo}` : (userStatus?.label || status.label)}
                                </Badge>
                            ) : (
                                <div className="flex flex-col items-center gap-1 text-center">
                                    <span className="text-[12px] font-bold text-muted-foreground/60 tracking-tight">
                                        課程名額
                                    </span>
                                    <div className="flex items-baseline gap-1.5 leading-none pl-1">
                                        <span className="text-[20px] font-black text-foreground tracking-tighter">
                                            {course.enrolledCount ?? 0}
                                        </span>
                                        <span className="text-[14px] font-medium text-muted-foreground/30 italic">/</span>
                                        <div className="flex items-baseline gap-0.5">
                                            <span className="text-[14px] font-bold text-muted-foreground/80 tracking-tighter">
                                                {course.capacity ?? 0}
                                            </span>
                                            <span className="text-[10px] font-bold text-muted-foreground/40 ml-0.5">位</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
