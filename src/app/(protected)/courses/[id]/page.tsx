'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Users,
    MapPin,
    Clock,
    ChevronLeft,
    Edit2,
    ClipboardCheck,
    Calendar,
    ArrowRight,
    Check,
    X,
    ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from 'next/link';

// Mock data (unifying with the same logic)
const MOCK_COURSE_DETAIL = {
    id: '1',
    name: '基礎律動 Basic Groove',
    teacher: 'A-May',
    type: 'trial',
    room: 'A教室',
    startTime: '19:00',
    endTime: '20:30',
    capacity: 30,
    enrolledCount: 22,
    leader: '小明',
    status: 'open',
    description: '本課程適合所有初學者。透過基礎律動訓練，建立身體協調性與節奏感。',
    // Unified Sessions and Attendance Data
    sessions: [
        { id: 's1', date: new Date(2026, 2, 2) },
        { id: 's2', date: new Date(2026, 2, 9) },
        { id: 's3', date: new Date(2026, 2, 16) },
        { id: 's4', date: new Date(2026, 2, 23) },
    ],
    // Sheet Structure
    roster: [
        {
            id: 'u1', name: '王小明', role: 'leader' as const, type: 'regular' as const,
            attendance: { 's1': 'v', 's2': 'v', 's3': 'x', 's4': '' } as Record<string, string>
        },
        {
            id: 'u2', name: '李華', role: 'member' as const, type: 'regular' as const,
            attendance: { 's1': 'x', 's2': 'v', 's3': 'v', 's4': '' } as Record<string, string>
        },
        {
            id: 'u3', name: '周杰倫', role: 'member' as const, type: 'regular' as const,
            attendance: { 's1': 'v', 's2': 'v', 's3': 'v', 's4': '' } as Record<string, string>
        },
        {
            id: 'u4', name: '林俊傑', role: 'member' as const, type: 'regular' as const,
            attendance: { 's1': 'v', 's2': 'x', 's3': 'v', 's4': '' } as Record<string, string>
        },
    ],
    addons: [
        {
            id: 'a1', name: '蔡依林', role: 'guest' as const, type: 'single' as const,
            attendance: { 's1': '單v', 's2': '單', 's3': '', 's4': '' } as Record<string, string>
        },
        {
            id: 'a2', name: '徐若瑄', role: 'member' as const, type: 'makeup' as const,
            attendance: { 's1': '補', 's2': '補v', 's3': '補x', 's4': '' } as Record<string, string>
        },
        {
            id: 'a3', name: '羅志祥', role: 'member' as const, type: 'transfer' as const,
            attendance: { 's1': '', 's2': '轉', 's3': '轉v', 's4': '' } as Record<string, string>
        },
    ]
};

const statusMap: Record<string, { label: string, color: string }> = {
    open: { label: '開放報名', color: 'bg-green-500/10 text-green-600 border-green-200' },
    full: { label: '額滿', color: 'bg-red-500/10 text-red-600 border-red-200' },
    upcoming: { label: '即將開放', color: 'bg-blue-500/10 text-blue-600 border-blue-200' },
    ended: { label: '已結束', color: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const course = MOCK_COURSE_DETAIL; // In reality, fetch by ID
    const status = statusMap[course.status] || statusMap['open'];

    // Simplified Attendance Rendering (Minimal Icons Only)
    const renderAttendanceCell = (val: string) => {
        if (!val) return <div className="h-full w-full flex items-center justify-center opacity-10"><div className="w-1.5 h-1.5 rounded-full bg-foreground" /></div>;

        const isPresent = val.toLowerCase().includes('v');
        const isAbsent = val.toLowerCase().includes('x');

        return (
            <div className={cn(
                "w-full h-full flex flex-col items-center justify-center transition-all px-1",
                isPresent ? "bg-green-500/10 text-green-600" :
                    isAbsent ? "bg-red-500/10 text-red-500" : "opacity-10"
            )}>
                {isPresent ? (
                    <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center text-white shadow-sm ring-4 ring-green-600/10">
                        <Check className="h-3 w-3 stroke-[3px]" />
                    </div>
                ) : isAbsent ? (
                    <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-white shadow-sm ring-4 ring-red-500/10">
                        <X className="h-3 w-3 stroke-[3px]" />
                    </div>
                ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
                )}
            </div>
        );
    };

    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header Area */}
            <div className="flex flex-col gap-5">
                {/* Main Header Row */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9 rounded-full shrink-0 -ml-2">
                            <ChevronLeft className="h-6 w-6" />
                        </Button>
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate leading-tight">{course.name}</h1>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <Button className="h-9 px-4 text-sm font-bold bg-white text-black hover:bg-white/90 shadow-lg rounded-lg transition-all active:scale-95">
                            <Edit2 className="h-4 w-4 mr-2" /> 編輯課程
                        </Button>
                    </div>
                </div>

                {/* Metadata & Smart Action Card */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5 bg-muted/20 border border-muted/50 rounded-2xl">
                    <div className="flex flex-col gap-4">
                        {/* Status as first item */}
                        <div className="flex items-center">
                            <Badge variant="outline" className={cn("px-2 py-0.5 text-xs font-bold rounded-md border-none ring-1 ring-inset", status.color)}>
                                {status.label}
                            </Badge>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            <div className="flex items-center gap-3">
                                <Users className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">老師: <span className="font-bold ml-1">{course.teacher}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Clock className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">時間: <span className="font-bold ml-1">{course.startTime}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <MapPin className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">地點: <span className="font-bold ml-1">{course.room}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Users className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">課程名額: <span className="font-bold ml-1">{course.capacity} 人</span></span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 py-2 sm:py-0 border-t sm:border-t-0 sm:border-l border-muted/30 sm:pl-8">
                        {/* 根據用戶狀態顯示不同的按鈕（模擬邏輯） */}
                        {course.status === 'open' ? (
                            <div className="flex flex-col gap-2">
                                <Button size="lg" className="h-11 px-8 text-sm font-black shadow-xl bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-all active:scale-95">
                                    立即報名
                                </Button>
                                <span className="text-[11px] text-muted-foreground text-center">目前尚有名額</span>
                            </div>
                        ) : course.status === 'full' ? (
                            <div className="flex flex-col gap-2">
                                <Button variant="outline" size="lg" className="h-11 px-8 text-sm font-black border-amber-500/50 text-amber-600 hover:bg-amber-50 rounded-xl transition-all">
                                    候補登記
                                </Button>
                                <span className="text-[11px] text-amber-500/70 text-center font-medium">目前候補第 3 位</span>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 items-center">
                                <div className="flex items-center gap-2 px-6 py-2 bg-green-500/10 text-green-600 rounded-xl border border-green-500/20 shadow-sm">
                                    <Check className="h-4 w-4 stroke-[3px]" />
                                    <span className="text-sm font-bold">已報名成功</span>
                                </div>
                                <Button variant="ghost" size="sm" className="h-8 text-[11px] font-bold text-muted-foreground hover:text-primary">
                                    查看詳情或轉讓
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Attendance Roster View */}
            <div className="flex flex-col pt-4">
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                        <ClipboardCheck className="h-4 w-4 text-primary" /> 學員名單
                    </h3>
                </div>

                <div className="relative rounded-xl border border-muted bg-card shadow-sm overflow-hidden">
                    <div className="overflow-x-auto overflow-y-visible">
                        <table className="w-full text-left border-collapse table-fixed min-w-[500px]">
                            <thead className="sticky top-0 z-30">
                                <tr className="bg-muted/10 border-b border-muted backdrop-blur-md">
                                    <th className="p-3 text-xs font-black uppercase text-muted-foreground italic sticky left-0 bg-card z-40 w-[80px] border-r border-muted/50 rounded-tl-xl shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        姓名
                                    </th>
                                    {course.sessions.map((s) => {
                                        // Calculate attendance for this session
                                        const totalStudents = [...course.roster, ...course.addons];
                                        // Expected: Students who have a non-empty attendance record for this session
                                        const expectedCount = totalStudents.filter(student => student.attendance[s.id] !== undefined).length;
                                        // Present: Students marked with 'v'
                                        const presentCount = totalStudents.filter(student =>
                                            student.attendance[s.id]?.toLowerCase().includes('v')
                                        ).length;

                                        return (
                                            <th key={s.id} className="p-2 text-center border-r border-muted/30 last:border-0 w-[70px]">
                                                <div className="flex flex-col items-center gap-1.5 text-foreground">
                                                    <span className="text-sm font-bold tracking-tight">{format(s.date, "M/d")}</span>
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-500/15 border border-emerald-500/20 px-1.5 py-0.5 rounded-full shadow-sm">
                                                        <Users className="h-2.5 w-2.5 stroke-[3px]" />
                                                        {presentCount}
                                                    </span>
                                                </div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="z-10 relative">
                                {/* Formal Members Section - Split for Sticky Effect */}
                                <tr className="bg-muted/10 border-b border-muted/30">
                                    <td className="sticky left-0 z-20 px-3 py-2 text-[11px] font-bold tracking-wider text-muted-foreground bg-muted/20 backdrop-blur-sm border-r border-muted/30 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        正式學員
                                    </td>
                                    <td colSpan={course.sessions.length} className="bg-muted/20 backdrop-blur-sm" />
                                </tr>
                                {course.roster.map((student) => (
                                    <tr key={student.id} className="border-b border-muted/30 hover:bg-muted/5 transition-colors group">
                                        <td className="p-3 text-xs font-bold sticky left-0 bg-card z-20 border-r border-muted/50 group-hover:bg-muted/10 transition-colors shadow-[4px_0_10px_-5px_rgba(0,0,0,0.05)]">
                                            <div className="flex items-center gap-1.5 overflow-hidden">
                                                <span className="truncate">{student.name}</span>
                                                {student.name === course.leader && (
                                                    <span className="shrink-0 px-1 py-0.5 bg-amber-500/10 text-amber-600 rounded text-[9px] font-black leading-none">班長</span>
                                                )}
                                            </div>
                                        </td>
                                        {course.sessions.map((s) => (
                                            <td key={s.id} className="p-0 border-r border-muted/20 last:border-0 text-center h-12">
                                                <button className="w-full h-full focus:outline-none hover:bg-muted/5 transition-all active:scale-95">
                                                    {renderAttendanceCell(student.attendance[s.id])}
                                                </button>
                                            </td>
                                        ))}
                                    </tr>
                                ))}

                                {/* Add-ons Section - Split for Sticky Effect */}
                                <tr className="bg-amber-500/5 border-b border-amber-500/10 border-t border-muted/50">
                                    <td className="sticky left-0 z-20 px-3 py-2 text-[11px] font-bold tracking-wider text-amber-700 bg-amber-500/10 backdrop-blur-sm border-r border-amber-500/20 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        加報學員
                                    </td>
                                    <td colSpan={course.sessions.length} className="bg-amber-500/10 backdrop-blur-sm" />
                                </tr>
                                {course.addons.map((student) => (
                                    <tr key={student.id} className="border-b border-muted/30 hover:bg-muted/5 transition-colors group">
                                        <td className="p-3 text-xs font-bold sticky left-0 bg-card z-20 border-r border-muted/50 group-hover:bg-muted/10 transition-colors shadow-[4px_0_10px_-5px_rgba(0,0,0,0.05)]">
                                            <div className="flex items-center gap-1.5 overflow-hidden">
                                                <span className="truncate">{student.name}</span>
                                                {student.name === course.leader && (
                                                    <span className="shrink-0 px-1 py-0.5 bg-amber-500/10 text-amber-600 rounded text-[9px] font-black leading-none">班長</span>
                                                )}
                                            </div>
                                        </td>
                                        {course.sessions.map((s) => (
                                            <td key={s.id} className="p-0 border-r border-muted/20 last:border-0 text-center h-12">
                                                <button className="w-full h-full focus:outline-none hover:bg-muted/5 transition-all active:scale-95">
                                                    {renderAttendanceCell(student.attendance[s.id])}
                                                </button>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
    );
}
