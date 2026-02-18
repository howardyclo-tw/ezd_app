'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Users,
    User,
    Crown,
    MapPin,
    Clock,
    ChevronLeft,
    Edit2,
    ClipboardCheck,
    Calendar,
    ArrowRight,
    Check,
    X,
    ChevronRight,
    Inbox
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from 'next/link';
import { useUserRole } from '@/components/providers/role-provider';

// Mock data (unifying with the same logic)
const MOCK_COURSES: Record<string, any> = {
    '1': {
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
        sessions: [
            { id: 's1', date: new Date(2026, 2, 2) },
            { id: 's2', date: new Date(2026, 2, 9) },
            { id: 's3', date: new Date(2026, 2, 16) },
            { id: 's4', date: new Date(2026, 2, 23) },
        ],
        roster: [
            { id: 'u1', name: '王小明', role: 'leader', type: 'regular', attendance: { 's1': 'v', 's2': 'v', 's3': 'x', 's4': '' } },
            { id: 'u2', name: '李華', role: 'member', type: 'regular', attendance: { 's1': 'x', 's2': '假', 's3': 'v', 's4': '' } },
            { id: 'u3', name: '周杰倫', role: 'member', type: 'regular', attendance: { 's1': 'v', 's2': 'v', 's3': 'v', 's4': '' } },
            { id: 'u4', name: '林俊傑', role: 'member', type: 'regular', attendance: { 's1': 'v', 's2': 'x', 's3': 'v', 's4': '' } },
        ],
        addons: [
            { id: 'a1', name: '蔡依林', role: 'guest', type: 'single', attendance: { 's1': '單v', 's2': '單', 's3': '', 's4': '' } },
            { id: 'a2', name: '徐若瑄', role: 'member', type: 'makeup', attendance: { 's1': '補', 's2': '補v', 's3': '補x', 's4': '' } },
            { id: 'a3', name: '羅志祥', role: 'member', type: 'transfer', attendance: { 's1': '', 's2': '轉', 's3': '轉v', 's4': '' } },
        ]
    },
    '2': {
        id: '2',
        name: '爵士舞進階 Jazz Advance',
        teacher: 'Nike',
        type: 'regular',
        room: 'B教室',
        startTime: '20:30',
        endTime: '22:00',
        capacity: 20,
        enrolledCount: 0,
        leader: '',
        status: 'open',
        description: '挑戰高難度的節奏組合與肢體開發。',
        sessions: [
            { id: 's1', date: new Date(2026, 2, 3) },
            { id: 's2', date: new Date(2026, 2, 10) },
        ],
        roster: [],
        addons: []
    }
};


export default function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();
    const course = MOCK_COURSES[id] || MOCK_COURSES['1'];
    const isEmpty = course.roster.length === 0 && course.addons.length === 0;

    // --- Interaction State ---
    const [isEditing, setIsEditing] = useState(false);
    const [rosterState, setRosterState] = useState(course.roster);
    const [addonsState, setAddonsState] = useState(course.addons);

    // --- Identity & Permissions (Real Auth State) ---
    const { role: currentRole, userName } = useUserRole();
    const isLeader = userName === course.leader;
    const isStaff = currentRole === 'admin' || currentRole === 'staff'; // admin and staff are both management roles
    const canManageAttendance = isLeader || isStaff;

    // Dynamic Attendance Toggle Logic
    const toggleAttendance = (studentId: string, sessionId: string, isAddon: boolean) => {
        const list = isAddon ? addonsState : rosterState;
        const setList = isAddon ? setAddonsState : setRosterState;

        const updatedList = list.map((s: any) => {
            if (s.id !== studentId) return s;

            const currentVal = s.attendance[sessionId] || '';
            if (currentVal.includes('假')) return s; // Locked status

            // Cycle: '' -> 'v' -> 'x' -> '' (Preserving suffixes like Makeup/Trial)
            const type = currentVal.replace(/[vx]/gi, '');
            let newVal = '';

            if (!currentVal.toLowerCase().includes('v') && !currentVal.toLowerCase().includes('x')) {
                newVal = type + 'v';
            } else if (currentVal.toLowerCase().includes('v')) {
                newVal = type + 'x';
            } else {
                newVal = type;
            }

            return {
                ...s,
                attendance: { ...s.attendance, [sessionId]: newVal }
            };
        });

        setList(updatedList);
    };

    // Enhanced Attendance Rendering
    const renderAttendanceCell = (val: string, isAddon: boolean, isEditingMode: boolean, onClick?: () => void) => {
        const isPresent = val.toLowerCase().includes('v');
        const isAbsent = val.toLowerCase().includes('x');
        const isLeave = val.includes('假');
        const typeLabel = val.replace(/[vx]/gi, '').trim();
        const hasType = typeLabel.length > 0;

        // "Enrolled" Logic: 
        // Regular students are always expected. 
        // Addon students are ONLY expected if they have a type label (Makeup/Trial/etc) or a mark.
        const isEnrolled = !isAddon || (isAddon && (val.length > 0));
        const canEdit = isEditingMode && isEnrolled && !isLeave;
        const isUnmarked = !isPresent && !isAbsent && !isLeave;

        return (
            <div
                onClick={canEdit ? onClick : undefined}
                className={cn(
                    "w-full h-full flex flex-col items-center justify-center transition-all duration-300 relative overflow-hidden gap-0.5",
                    !isEnrolled ? "bg-muted/30 opacity-40 cursor-not-allowed" : // Visual state for non-enrolled sessions
                        isPresent ? "bg-green-500/10 text-green-600" :
                            isAbsent ? "bg-red-500/10 text-red-500" :
                                isLeave ? "bg-blue-500/10 text-blue-600" : "opacity-100",
                    isEnrolled && hasType && !isPresent && !isAbsent && !isLeave && "text-muted-foreground",
                    canEdit && "cursor-pointer hover:bg-primary/5 active:scale-95 group/cell"
                )}
            >
                {/* Edit Mode Highlight Border (Subtle hint) */}
                {canEdit && (
                    <div className="absolute inset-0 border border-transparent group-hover/cell:border-primary/20 transition-colors pointer-events-none" />
                )}

                {/* Visual Stack: Mark + Label or Default Dot */}
                {isEnrolled ? (
                    (isPresent || isAbsent) ? (
                        <>
                            <div className={cn(
                                "rounded-full flex items-center justify-center text-white shadow-sm ring-4 transition-all duration-300 z-10",
                                isPresent ? "bg-green-600 ring-green-600/10" : "bg-red-500 ring-red-500/10",
                                hasType ? "w-4.5 h-4.5" : "w-5 h-5"
                            )}>
                                {isPresent ? <Check className="h-3 w-3 stroke-[3px]" /> : <X className="h-3 w-3 stroke-[3px]" />}
                            </div>
                            {hasType && (
                                <span className="text-[10px] font-bold leading-none mt-0.5 opacity-80">
                                    {typeLabel}
                                </span>
                            )}
                        </>
                    ) : (isLeave || hasType) ? (
                        <span className="text-xs font-bold leading-none">
                            {isLeave ? "假" : typeLabel}
                        </span>
                    ) : (
                        <div className={cn(
                            "rounded-full bg-foreground transition-all duration-300",
                            isUnmarked ? "w-2 h-2 opacity-20" : "opacity-0"
                        )} />
                    )
                ) : null /* Non-enrolled sessions are completely empty */}
            </div>
        );
    };

    // Default focus logic: Today > First Session > Null
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const initialSessionId = course.sessions.find((s: any) => format(s.date, "yyyy-MM-dd") === todayStr)?.id || course.sessions[0]?.id || null;

    const [focusedSessionId, setFocusedSessionId] = useState<string | null>(initialSessionId);

    // Filter Logic: If a session is focused, only show addons relevant to that session
    const focusedSession = course.sessions.find((s: any) => s.id === focusedSessionId);
    const visibleAddons = focusedSessionId
        ? addonsState.filter((s: any) => s.attendance[focusedSessionId])
        : addonsState;

    const toggleFocus = (sessionId: string) => {
        if (focusedSessionId === sessionId) {
            setFocusedSessionId(null); // Toggle off
        } else {
            setFocusedSessionId(sessionId);
        }
    };

    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header Area */}
            <div className="flex flex-col gap-5">
                {/* Main Header Row */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-1 min-w-0">
                        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9 rounded-full shrink-0">
                            <ChevronLeft className="h-6 w-6" />
                        </Button>
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate leading-tight">{course.name}</h1>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            className="h-9 px-4 text-sm font-bold bg-white text-black hover:bg-white/90 shadow-lg rounded-lg transition-all active:scale-95"
                        >
                            <Edit2 className="h-4 w-4 mr-2" /> 編輯課程
                        </Button>
                    </div>
                </div>

                {/* Metadata & Smart Action Card */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-5 bg-muted/20 border border-muted/50 rounded-2xl">
                    <div className="flex flex-col gap-4 text-foreground">
                        {/* Status Badge Restored */}
                        <div className="flex items-center">
                            <Badge variant="outline" className="px-2 py-0.5 text-xs font-bold rounded-md border-none ring-1 ring-inset bg-green-500/10 text-green-700 ring-green-200">
                                開放報名
                            </Badge>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <div className="flex items-center gap-3">
                                <User className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">老師: <span className="font-bold ml-1">{course.teacher}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Crown className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">班長: <span className={cn("ml-1 font-bold", !course.leader && "text-muted-foreground/60")}>{course.leader || "未指定"}</span></span>
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
                                <span className="text-sm font-medium">名額: <span className="font-bold ml-1">{course.capacity} 人</span></span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Attendance Roster View */}
            <div className="flex flex-col pt-4">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-3">
                        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground/90">
                            <ClipboardCheck className="h-4 w-4 text-primary" />
                            學員名單
                        </h3>

                        {canManageAttendance && (
                            <>
                                <div className="h-4 w-[1px] bg-muted-foreground/20 mx-1" />

                                <div className="flex items-center gap-3">
                                    {isEditing ? (
                                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setRosterState(course.roster);
                                                    setAddonsState(course.addons);
                                                    setIsEditing(false);
                                                }}
                                                className="h-7 px-3 text-xs font-bold border-white/10 hover:bg-white/5 hover:text-white transition-all text-white/70"
                                            >
                                                取消
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={() => setIsEditing(false)}
                                                className="h-7 px-4 text-xs font-black bg-white text-black hover:bg-white/90 shadow-md rounded-lg transition-all active:scale-95"
                                            >
                                                儲存
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsEditing(true)}
                                            className="h-7 px-3 text-xs font-bold border-primary/30 text-primary hover:bg-primary/5 hover:border-primary/50 transition-all"
                                        >
                                            點名
                                        </Button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="relative rounded-xl border border-muted bg-card shadow-sm overflow-hidden group/table">
                    {/* 右側捲動提示陰影 (Scroll Hint) */}
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background/80 via-background/20 to-transparent z-40" />

                    <div className="overflow-x-auto overflow-y-visible">
                        <table className="w-full text-left border-collapse table-fixed min-w-[500px]">
                            <thead className="sticky top-0 z-30">
                                <tr className="bg-muted/10 border-b border-muted backdrop-blur-md">
                                    <th className="p-3 text-xs font-black uppercase text-muted-foreground italic sticky left-0 bg-card z-40 w-[80px] border-r border-muted/50 rounded-tl-xl shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        姓名
                                    </th>
                                    {course.sessions.map((s: any) => {
                                        // Total students list
                                        const allStudents = [...rosterState, ...addonsState];

                                        // Enrolled: Students who have a record for this specific session
                                        const enrolledCount = allStudents.filter(student =>
                                            student.attendance[s.id] && student.attendance[s.id].length > 0
                                        ).length;

                                        // Present: Students marked with 'v'
                                        const presentCount = allStudents.filter(student =>
                                            student.attendance[s.id]?.toLowerCase().includes('v')
                                        ).length;

                                        const isInactive = enrolledCount === 0;
                                        const isFocused = focusedSessionId === s.id;
                                        const isToday = format(s.date, "yyyy-MM-dd") === todayStr;

                                        return (
                                            <th
                                                key={s.id}
                                                onClick={() => toggleFocus(s.id)}
                                                className={cn(
                                                    "p-2 text-center border-r border-muted/30 last:border-0 w-[80px] transition-all cursor-pointer relative group/header overflow-visible",
                                                    isInactive && !isFocused && "opacity-40 hover:opacity-100",
                                                    isFocused ? "z-30" : "hover:bg-muted/5"
                                                )}
                                            >
                                                {/* Focus Indicator Bar */}
                                                <div className={cn(
                                                    "absolute inset-x-0 top-0 h-1 transition-all",
                                                    isFocused ? "bg-primary" : "bg-transparent group-hover/header:bg-primary/30"
                                                )} />

                                                <div className="flex flex-col items-center gap-1.5 relative py-1">
                                                    {isToday && (
                                                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-black text-primary bg-primary/10 px-1 rounded-sm border border-primary/20 whitespace-nowrap">
                                                            今日
                                                        </span>
                                                    )}

                                                    <span className={cn(
                                                        "text-sm font-bold tracking-tight transition-colors flex items-center gap-1",
                                                        isFocused ? "text-primary scale-110" : "text-foreground group-hover/header:text-primary"
                                                    )}>
                                                        {format(s.date, "M/d")}
                                                    </span>

                                                    <span className={cn(
                                                        "inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 transition-all outline-none",
                                                        isFocused
                                                            ? "text-primary bg-primary/10 border border-primary/20 rounded-full shadow-sm"
                                                            : "text-muted-foreground/60 border-transparent bg-transparent"
                                                    )}>
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
                                {/* Formal Members Section */}
                                <tr className="bg-muted/5 border-b border-muted/20">
                                    <td className="sticky left-0 z-30 px-3 py-2 text-[11px] font-bold tracking-wider text-muted-foreground bg-card border-r border-muted/30 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        常態學員
                                    </td>
                                    <td colSpan={course.sessions.length} className="bg-muted/5" />
                                </tr>

                                {rosterState.length === 0 ? (
                                    <tr className="border-b border-muted/20">
                                        <td colSpan={course.sessions.length + 1} className="py-12 text-center text-sm text-muted-foreground italic bg-muted/5">
                                            尚無常態學員名單
                                        </td>
                                    </tr>
                                ) : (
                                    rosterState.map((student: any) => (
                                        <tr key={student.id} className="border-b border-muted/20 hover:bg-muted/5 transition-colors group">
                                            <td className="p-3 text-xs font-bold sticky left-0 bg-card z-30 border-r border-muted/50 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.05)]">
                                                <div className="flex items-center gap-1.5 overflow-hidden">
                                                    <span className="truncate">{student.name}</span>
                                                    {student.name === course.leader && (
                                                        <span className="shrink-0 px-1 py-0.5 bg-amber-500/10 text-amber-600 rounded text-[9px] font-black leading-none">班長</span>
                                                    )}
                                                </div>
                                            </td>
                                            {course.sessions.map((s: any) => {
                                                const isFocused = focusedSessionId === s.id;
                                                return (
                                                    <td key={s.id} className={cn(
                                                        "p-0 border-r border-muted/20 last:border-0 text-center h-12 transition-all relative overflow-hidden",
                                                        isFocused && "z-20"
                                                    )}>
                                                        {renderAttendanceCell(
                                                            student.attendance[s.id] || '',
                                                            false,
                                                            isEditing,
                                                            () => toggleAttendance(student.id, s.id, false)
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))
                                )}

                                {/* Add-ons Section */}
                                <tr className="bg-muted/5 border-b border-muted/20 border-t border-muted/50">
                                    <td className="sticky left-0 z-30 px-3 py-2 text-[11px] font-bold tracking-wider text-muted-foreground bg-card border-r border-muted/30 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                                            <span>加報學員</span>
                                            {focusedSession && (
                                                <span className="text-primary/70 normal-case">
                                                    ({format(focusedSession.date, "M/d")} 名單)
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td colSpan={course.sessions.length} className="bg-muted/5" />
                                </tr>

                                {visibleAddons.length === 0 ? (
                                    <tr className="border-b border-muted/20">
                                        <td colSpan={course.sessions.length + 1} className="py-8 text-center text-sm text-muted-foreground/50 italic">
                                            {focusedSession ? `本堂 (${format(focusedSession.date, "M/d")}) 無加報學員` : "尚無加報學員名單"}
                                        </td>
                                    </tr>
                                ) : (
                                    visibleAddons.map((student: any) => (
                                        <tr key={student.id} className="border-b border-muted/20 hover:bg-muted/5 transition-colors group">
                                            <td className="p-3 text-xs font-bold sticky left-0 bg-card z-30 border-r border-muted/50 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.05)]">
                                                <div className="flex items-center gap-1.5 overflow-hidden">
                                                    <span className="truncate">{student.name}</span>
                                                    {student.name === course.leader && (
                                                        <span className="shrink-0 px-1 py-0.5 bg-amber-500/10 text-amber-600 rounded text-[9px] font-black leading-none">班長</span>
                                                    )}
                                                </div>
                                            </td>
                                            {course.sessions.map((s: any) => {
                                                const isFocused = focusedSessionId === s.id;
                                                return (
                                                    <td key={s.id} className={cn(
                                                        "p-0 border-r border-muted/20 last:border-0 text-center h-12 transition-all relative overflow-hidden",
                                                        isFocused && "z-20"
                                                    )}>
                                                        {renderAttendanceCell(
                                                            student.attendance[s.id] || '',
                                                            true,
                                                            isEditing,
                                                            () => toggleAttendance(student.id, s.id, true)
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
    );
}
