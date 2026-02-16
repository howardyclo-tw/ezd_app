'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
    Plus,
    Search,
    CalendarCheck, // Swap icon for variation
    Users,
    MapPin,
    Clock,
    UserCircle
} from "lucide-react";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// Mock data
const MOCK_COURSES = [
    { id: '1', name: '基礎律動 Basic Groove', teacher: 'A-May', type: 'normal', room: 'A教室', startTime: '19:00', endTime: '20:30', sessionsCount: 8, capacity: 30, enrolled: 28, status: 'published', nextSession: '2024-02-18' },
    { id: '2', name: 'Hip Hop 中級進階', teacher: 'Xiao-Gui', type: 'normal', room: 'B教室', startTime: '20:40', endTime: '22:10', sessionsCount: 8, capacity: 25, enrolled: 15, status: 'published', nextSession: '2024-02-18' },
    { id: '3', name: '新人試跳班 (Friday Special)', teacher: 'Momo', type: 'trial', room: 'A教室', startTime: '18:30', endTime: '19:30', sessionsCount: 1, capacity: 40, enrolled: 42, status: 'published', nextSession: '2024-02-20' },
    { id: '4', name: '暑期專攻班：Locking 101', teacher: 'Ivan', type: 'workshop', room: 'C教室', startTime: '14:00', endTime: '17:00', sessionsCount: 4, capacity: 20, enrolled: 0, status: 'draft', nextSession: null },
];

const STATUS_MAP = {
    published: { label: '已發布', color: 'text-emerald-700 bg-emerald-50 border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20' },
    draft: { label: '草稿', color: 'text-slate-600 bg-slate-100 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' },
    closed: { label: '已結束', color: 'text-red-700 bg-red-50 border-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
};

const TYPE_LABELS: Record<string, string> = {
    normal: '一般', trial: '試跳', special: '特殊', style: '風格', workshop: '專攻', rehearsal: '團練', performance: '表演',
};

export default function CoursesPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('all');

    return (
        <div className="container max-w-5xl py-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight">課程管理</h1>
                    <p className="text-sm text-muted-foreground">管理所有的舞蹈課程與報名狀態</p>
                </div>
                <Link href="/courses/new">
                    <Button size="sm" className="h-9 rounded-full font-bold shadow-sm transition-all hover:shadow-md px-5">
                        <Plus className="mr-1.5 w-4 h-4" /> 新增課程
                    </Button>
                </Link>
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-3 items-center bg-card/50 p-1 rounded-2xl border border-border/40 shadow-sm backdrop-blur-sm">
                <div className="relative flex-1 w-full sm:w-auto">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                    <Input
                        placeholder="搜尋課程..."
                        className="pl-10 h-10 border-transparent bg-transparent focus-visible:ring-0 focus-visible:bg-background/50 rounded-xl transition-all"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="w-px h-6 bg-border/60 hidden sm:block" />
                <Tabs defaultValue="all" className="w-full sm:w-auto" onValueChange={setActiveTab}>
                    <TabsList className="h-9 p-0.5 bg-muted/60 rounded-xl">
                        {['all', 'published', 'draft'].map((tab) => (
                            <TabsTrigger
                                key={tab}
                                value={tab}
                                className="rounded-lg text-xs font-bold px-4 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
                            >
                                {tab === 'all' ? '全部' : tab === 'published' ? '已發布' : '草稿'}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            {/* Course Cards Grid - Modern Style */}
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-2">
                {MOCK_COURSES
                    .filter(c => activeTab === 'all' || c.status === activeTab)
                    .filter(c => c.name.includes(searchQuery) || c.teacher.includes(searchQuery))
                    .map((course) => (
                        <Link key={course.id} href={`/courses/${course.id}`}>
                            <Card className="group relative border-border/50 hover:border-primary/30 shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden bg-card/60 backdrop-blur-sm hover:bg-card">
                                {/* Decorative Background gradient */}
                                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                                <CardContent className="p-5 flex flex-col h-full relative z-10">
                                    {/* Header Row */}
                                    <div className="flex justify-between items-start mb-4">
                                        <Badge variant="outline" className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold border shaodw-sm", STATUS_MAP[course.status as keyof typeof STATUS_MAP].color)}>
                                            {STATUS_MAP[course.status as keyof typeof STATUS_MAP].label}
                                        </Badge>
                                        <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground/80">
                                            {TYPE_LABELS[course.type]}
                                        </Badge>
                                    </div>

                                    {/* Main Info Block */}
                                    <div className="mb-6 space-y-1.5">
                                        <h3 className="text-lg font-bold text-foreground leading-snug group-hover:text-primary transition-colors pr-2">
                                            {course.name}
                                        </h3>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                                            <UserCircle className="h-4 w-4 text-primary/60" />
                                            <span>{course.teacher}</span>
                                        </div>
                                    </div>

                                    {/* Modern Info Grid */}
                                    <div className="mt-auto grid grid-cols-2 gap-2">
                                        {/* Left: Time & Location */}
                                        <div className="space-y-2 bg-muted/30 rounded-xl p-3 border border-border/30">
                                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                                <Clock className="h-3.5 w-3.5 text-primary/50" />
                                                <span>{course.startTime}-{course.endTime}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                                <MapPin className="h-3.5 w-3.5 text-primary/50" />
                                                <span>{course.room}</span>
                                            </div>
                                        </div>

                                        {/* Right: Stats (Sessions / Students) */}
                                        <div className="space-y-2 bg-muted/30 rounded-xl p-3 border border-border/30 flex flex-col justify-center">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground/70 font-medium">總堂數</span>
                                                <span className="font-bold">{course.sessionsCount} 堂</span>
                                            </div>
                                            {/* Progress Bar Style Visualization for Capacity */}
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-muted-foreground/70 font-medium">報名</span>
                                                    <span className={cn("font-bold", course.enrolled >= course.capacity ? "text-red-500" : "text-foreground")}>
                                                        {course.enrolled}/{course.capacity}
                                                    </span>
                                                </div>
                                                <div className="h-1.5 w-full bg-background/50 rounded-full overflow-hidden border border-border/20">
                                                    <div
                                                        className={cn("h-full rounded-full transition-all", course.enrolled >= course.capacity ? "bg-red-500" : "bg-primary")}
                                                        style={{ width: `${Math.min((course.enrolled / course.capacity) * 100, 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
            </div>
        </div>
    );
}
