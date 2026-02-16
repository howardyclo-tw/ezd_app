'use client';

import { useState } from 'react';
import { CourseGroupCard } from "@/components/courses/course-group-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Mock course groups as seasons/folders
const COURSE_GROUPS = [
    {
        id: '2026-trial',
        title: 'HQ 2026 3月 常態試跳',
        period: '2026/03/01 - 2026/03/31',
        status: 'active',
        type: 'trial',
        courseCount: 8,
    },
    {
        id: '2026-h1',
        title: 'HQ 2026 H1 常態課程',
        period: '2026/03/01 - 2026/06/30',
        status: 'upcoming',
        type: 'regular',
        courseCount: 12,
    },
    {
        id: '2026-workshop',
        title: 'HQ 2026 1~2月 風格體驗 & Workshop',
        period: '2026/01/01 - 2026/02/28',
        status: 'ended',
        type: 'workshop',
        courseCount: 5,
    },
];

export default function CourseGroupsPage() {
    const [filter, setFilter] = useState('all');

    const filteredGroups = COURSE_GROUPS
        .filter(group => {
            if (filter === 'all') return true;
            return group.status === filter;
        })
        .sort((a, b) => {
            const endA = a.period.split(' - ')[1];
            const endB = b.period.split(' - ')[1];
            return endB.localeCompare(endA);
        });

    return (
        <div className="container max-w-4xl py-10 space-y-6">
            <div className="space-y-1.5 mb-10 text-center">
                <h1 className="text-2xl font-bold tracking-tight">課程檔期</h1>
                <p className="text-muted-foreground text-sm font-medium">瀏覽目前課程檔期，一起來跳舞吧!</p>
            </div>

            {/* Filter Tabs (Centered) */}
            <div className="flex justify-center mb-10 overflow-x-auto">
                <Tabs defaultValue="all" className="w-auto" onValueChange={setFilter}>
                    <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 flex-nowrap">
                        <TabsTrigger value="all" className="text-xs px-5 font-bold data-[state=active]:shadow-sm">全部檔期</TabsTrigger>
                        <TabsTrigger value="active" className="text-xs px-5 font-bold data-[state=active]:shadow-sm">進行中</TabsTrigger>
                        <TabsTrigger value="upcoming" className="text-xs px-5 font-bold data-[state=active]:shadow-sm">即將開始</TabsTrigger>
                        <TabsTrigger value="ended" className="text-xs px-5 font-bold data-[state=active]:shadow-sm">已結束</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <div className="grid gap-4">
                {filteredGroups.length > 0 ? (
                    filteredGroups.map((group) => (
                        <CourseGroupCard key={group.id} group={group} />
                    ))
                ) : (
                    <div className="text-center py-24 border-2 border-dashed border-muted rounded-2xl bg-muted/5">
                        <p className="text-muted-foreground text-sm font-semibold italic">目前沒有符合該狀態的檔期</p>
                    </div>
                )}
            </div>
        </div>
    );
}
