'use client';

import { CourseCard } from '@/components/courses/course-card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

// Mock Data
const MOCK_MY_COURSES = [
    {
        id: 'c1',
        name: '基礎律動 Basic Groove',
        teacher: 'A-May',
        time: '03/10 (二) 20:30 @ B教室',
        location: 'B 教室',
        type: 'regular',
        status: 'open',
        userStatus: 'enrolled', // 已報名
    },
    {
        id: 'c2',
        name: 'Hiphop 初級 Hiphop Basic',
        teacher: '小 P',
        time: '03/15 (日) 14:00 @ A教室',
        location: 'A 教室',
        type: 'regular',
        status: 'open',
        userStatus: 'waitlist', // 候補中 (候補2)
        waitingNo: 2,
    },
    {
        id: 'c3',
        name: 'Jazz Advance 爵士進階',
        teacher: 'Nike',
        time: '03/12 (四) 19:30 @ C教室',
        location: 'C 教室',
        type: 'regular',
        status: 'open',
        userStatus: 'leave', // 已請假
    },
    {
        id: 'c4',
        name: 'Breaking Foundation',
        teacher: 'B-Boy T',
        time: '03/11 (三) 18:30 @ B教室',
        location: 'B 教室',
        type: 'regular',
        status: 'open',
        userStatus: 'transferred_out', // 已轉出
    },
    {
        id: 'c5',
        name: 'Popping Session',
        teacher: 'Boogaloo',
        time: '03/13 (五) 21:00 @ A教室',
        location: 'A 教室',
        type: 'regular',
        status: 'open',
        userStatus: 'transferred_in', // 已轉入
    },
    {
        id: 'c6-history',
        name: 'Locking 基礎 Locking 101',
        teacher: '阿偉',
        time: '2026/02/15 已結業',
        location: 'A 教室',
        type: 'regular',
        status: 'ended',
        userStatus: 'ended', // 已結束
    }
];

export default function MyCoursesPage() {
    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header: Exact mirror of courses group detail header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-9 w-9 -ml-2 shrink-0">
                        <Link href="/dashboard">
                            <ChevronLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight leading-tight">我的課程</h1>
                        <p className="text-sm text-muted-foreground font-medium mt-0.5">
                            查看預約、報名與課表
                        </p>
                    </div>
                </div>
            </div>

            {/* List Content: Mirroring the grid layout from courses group detail */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                {MOCK_MY_COURSES.map((course) => (
                    <div key={course.id} className={course.userStatus === 'ended' || course.userStatus === 'transferred_out' ? "opacity-60 grayscale transition-all text-sm" : ""}>
                        <CourseCard course={{
                            ...course,
                            isManagement: true
                        }} />
                    </div>
                ))}
            </div>
        </div>
    );
}
