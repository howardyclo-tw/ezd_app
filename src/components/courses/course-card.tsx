'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Clock, MapPin, ChevronRight, Calendar } from "lucide-react";
import Link from 'next/link';

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
    const avatarColor = stringToColor(course.teacher);

    return (
        <Link href={`/courses/${course.id}`} className="block">
            <Card className="border-border/40 shadow-sm hover:shadow-md transition-all hover:border-primary/20 active:scale-[0.99] group overflow-hidden">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                    {/* Left: Avatar + Info */}
                    <div className="flex items-center gap-4 min-w-0">
                        {/* Avatar */}
                        <div className="shrink-0 relative">
                            <div
                                className="h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-sm ring-2 ring-white"
                                style={{ backgroundColor: avatarColor }}
                            >
                                {course.teacher.charAt(0)}
                            </div>
                        </div>

                        {/* Text Info */}
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-base leading-none truncate">
                                    {course.teacher} {course.name}
                                </h3>
                            </div>

                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                                <Clock className="h-3 w-3 shrink-0" />
                                <span>{course.time}</span>
                                <span className="opacity-50">•</span>
                                <span>{course.type === 'trial' ? '入門' : course.type === 'regular' ? '常態' : '專攻'}</span>
                            </div>

                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium truncate">
                                <User className="h-3 w-3 shrink-0" />
                                <span>{course.teacher}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right: Button */}
                    <div className="shrink-0">
                        <Button
                            variant="secondary"
                            size="sm"
                            className={`h-8 px-4 text-xs font-bold rounded-full ${course.status === 'open' ? 'bg-primary text-primary-foreground hover:bg-primary/90' :
                                'bg-muted text-muted-foreground hover:bg-muted'
                                } ${course.status === 'full' || course.status === 'ended' ? 'opacity-70' : ''}`}
                        >
                            {status.label}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
