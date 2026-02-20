'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CourseGroupCard } from "./course-group-card";

interface GroupData {
    id: string;
    title: string;
    period: string;
    status: string;
    courseCount: number;
    courses: {
        id: string;
        name: string;
        teacher: string;
        time: string;
        location: string;
        type: string;
        status: string;
        capacity: number;
        startDate: string;
        endDate: string;
    }[];
}

export function CourseGroupFilter({ groups }: { groups: GroupData[] }) {
    const [filter, setFilter] = useState('all');

    const filteredGroups = groups
        .filter(group => {
            if (filter === 'all') return true;
            return group.status === filter;
        })
        .sort((a, b) => {
            const endA = a.period.split(' - ')[1] ?? '';
            const endB = b.period.split(' - ')[1] ?? '';
            return endB.localeCompare(endA);
        });

    return (
        <>
            {/* Filter Tabs */}
            <div className="flex justify-center mb-10 px-4 sm:px-0">
                <Tabs defaultValue="all" className="w-full sm:w-auto" onValueChange={setFilter}>
                    <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 w-full grid grid-cols-4 sm:flex sm:grid-cols-none sm:w-auto">
                        <TabsTrigger value="all" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">全部檔期</TabsTrigger>
                        <TabsTrigger value="active" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">進行中</TabsTrigger>
                        <TabsTrigger value="upcoming" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">即將開始</TabsTrigger>
                        <TabsTrigger value="ended" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">已結束</TabsTrigger>
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
        </>
    );
}
