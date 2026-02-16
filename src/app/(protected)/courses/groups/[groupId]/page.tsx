'use client';

import { use } from 'react';
import { Button } from "@/components/ui/button";
import { CourseCard } from "@/components/courses/course-card";
import { ChevronLeft, Calendar as CalendarIcon, ClipboardList } from "lucide-react";
import Link from 'next/link';
import { format, min, max, parseISO, isValid } from 'date-fns';
import { zhTW } from 'date-fns/locale';

// Mock specific course list for this group
const MOCK_GROUP_COURSES: Record<string, any> = {
    '2026-trial': {
        title: 'HQ 2026 3月 常態試跳',
        description: '適合新手的基礎體驗課程。',
        courses: [
            { id: 't1', name: 'Hip Hop 初級體驗', teacher: 'A-May', time: '週一 19:30-21:00', location: 'A教室', type: 'trial', status: 'open', startDate: '2026-03-02', endDate: '2026-03-30' },
            { id: 't2', name: 'Locking 基礎律動', teacher: 'Kenji', time: '週三 19:00-20:30', location: 'B教室', type: 'trial', status: 'open', startDate: '2026-03-04', endDate: '2026-03-25' },
            { id: 't3', name: 'Jazz Funk 風格入門', teacher: 'Momo', time: '週五 20:00-21:30', location: 'A教室', type: 'trial', status: 'full', startDate: '2026-03-06', endDate: '2026-03-27' },
        ]
    },
    '2026-h1': {
        title: 'HQ 2026 H1 常態課程',
        description: '長期的進階訓練課程。',
        courses: [
            { id: 'r1', name: 'Hip Hop 中級進階', teacher: 'Xiao-Gui', time: '週二 20:40-22:10', location: 'B教室', type: 'regular', status: 'upcoming', startDate: '2026-03-10', endDate: '2026-06-23' },
            { id: 'r2', name: 'Popping 基礎應用', teacher: 'Popcorn', time: '週四 19:00-20:30', location: 'C教室', type: 'regular', status: 'upcoming', startDate: '2026-03-12', endDate: '2026-06-25' },
        ]
    },
    '2026-workshop': {
        title: 'HQ 2026 1~2月 風格體驗 & Workshop',
        description: '寒假專攻班 (已結束)。',
        courses: [
            { id: 'w1', name: 'Litefeet 基礎', teacher: 'Xiao-Lin', time: '週四 19:30', location: 'E教室', type: 'workshop', status: 'ended', startDate: '2026-01-08', endDate: '2026-01-29' },
        ]
    }
};

export default function CourseGroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
    const { groupId } = use(params);
    const groupData = MOCK_GROUP_COURSES[groupId];

    if (!groupData) {
        return (
            <div className="container py-20 text-center space-y-4">
                <h1 className="text-2xl font-bold">檔期資料不存在</h1>
                <p className="text-muted-foreground">找不到該檔期的課程資訊。</p>
                <Button asChild><Link href="/courses">返回列表</Link></Button>
            </div>
        );
    }

    // Task 1: Infer group period from courses
    const courseDates = groupData.courses.flatMap((c: any) => [
        parseISO(c.startDate),
        parseISO(c.endDate)
    ]).filter(isValid);

    const inferredPeriod = courseDates.length > 0
        ? `${format(min(courseDates), 'yyyy/MM/dd')} - ${format(max(courseDates), 'yyyy/MM/dd')}`
        : '檔期時間未定';

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-8 w-8 -ml-2">
                        <Link href="/courses"><ChevronLeft className="h-5 w-5" /></Link>
                    </Button>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">{groupData.title}</h1>
                        <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 mt-0.5">
                            <CalendarIcon className="h-3 w-3" /> {inferredPeriod} (自動推算)
                        </p>
                    </div>
                </div>
            </div>

            {/* Course List as Cards (Grid Layout) */}
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                {groupData.courses.map((course: any) => (
                    <CourseCard key={course.id} course={course} />
                ))}
            </div>
        </div>
    );
}
