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
    ArrowRight
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
    sessionsCount: 8,
    capacity: 30,
    status: 'open',
    description: '本課程適合所有初學者。透過基礎律動訓練，建立身體協調性與節奏感。',
    sessions: [
        { id: 's1', date: new Date(2026, 2, 2), sequence: 1, attendance: 28, status: 'completed' },
        { id: 's2', date: new Date(2026, 2, 9), sequence: 2, attendance: 30, status: 'completed' },
        { id: 's3', date: new Date(2026, 2, 16), sequence: 3, attendance: 0, status: 'upcoming' },
        { id: 's4', date: new Date(2026, 2, 23), sequence: 4, attendance: 0, status: 'upcoming' },
    ],
    students: [
        { id: 'u1', name: '王小明', role: 'member', employee_id: 'E12345', phone: '0912-345-678', status: 'paid' },
        { id: 'u2', name: '李華', role: 'guest', phone: '0922-111-222', status: 'paid' },
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

    return (
        <div className="container max-w-5xl py-6 space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9 rounded-full shrink-0 -ml-2">
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <h1 className="text-2xl font-bold tracking-tight leading-tight">{course.name}</h1>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Button variant="outline" size="sm" className="h-10 text-sm font-bold border-muted flex-1 sm:flex-none shadow-sm">
                        <Edit2 className="h-4 w-4 mr-2" /> 編輯課程
                    </Button>
                </div>
            </div>

            {/* Compact Info Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-muted/30 p-3 rounded-xl flex flex-col gap-1">
                    <span className="text-xs uppercase font-black text-muted-foreground italic tracking-wider">狀態</span>
                    <Badge variant="outline" className={cn("px-2 py-0.5 h-5 text-xs w-fit font-bold rounded-sm border-none shadow-none", status.color)}>
                        {status.label}
                    </Badge>
                </div>
                <div className="bg-muted/30 p-3 rounded-xl flex flex-col gap-1">
                    <span className="text-xs uppercase font-black text-muted-foreground italic tracking-wider">授課老師</span>
                    <span className="text-base font-bold">{course.teacher}</span>
                </div>
                <div className="bg-muted/30 p-3 rounded-xl flex flex-col gap-1">
                    <span className="text-xs uppercase font-black text-muted-foreground italic tracking-wider">上課時間</span>
                    <span className="text-base font-bold">{course.startTime} - {course.endTime}</span>
                </div>
                <div className="bg-muted/30 p-3 rounded-xl flex flex-col gap-1">
                    <span className="text-xs uppercase font-black text-muted-foreground italic tracking-wider">地點</span>
                    <span className="text-base font-bold">{course.room}</span>
                </div>
            </div>

            {/* Tabs Section */}
            <Tabs defaultValue="sessions" className="w-full">
                <TabsList className="w-full justify-start h-11 p-0 bg-transparent border-b rounded-none gap-6">
                    <TabsTrigger value="sessions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 pb-3 text-sm font-bold transition-all">
                        課堂進度 ({course.sessions.length})
                    </TabsTrigger>
                    <TabsTrigger value="students" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 pb-3 text-sm font-bold transition-all">
                        學員名單
                    </TabsTrigger>
                    <TabsTrigger value="info" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 pb-3 text-sm font-bold transition-all">
                        課程細節
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="sessions" className="pt-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {course.sessions.map((session) => (
                            <Card key={session.id} className="border-muted hover:bg-muted/5 shadow-none transition-colors">
                                <CardContent className="p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={cn(
                                            "h-8 w-8 rounded flex items-center justify-center font-black text-xs",
                                            session.status === 'completed' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                        )}>
                                            {session.sequence}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm sm:text-base">
                                                {format(session.date, "M/d (eee)", { locale: zhTW })}
                                            </p>
                                            <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 mt-0.5">
                                                <Users className="h-3 w-3" /> {session.attendance}/{course.capacity}
                                            </p>
                                        </div>
                                    </div>
                                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary">
                                        <ClipboardCheck className="h-5 w-5" />
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="students" className="pt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        {course.students.map((student) => (
                            <Card key={student.id} className="border-muted/50 shadow-none hover:bg-muted/5">
                                <CardContent className="p-4 flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-4">
                                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                                            {student.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm sm:text-base">{student.name} {student.role === 'leader' && <Badge className="ml-1 h-4 text-[10px] bg-amber-500">班長</Badge>}</p>
                                            <p className="text-xs text-muted-foreground italic font-medium mt-0.5">{student.employee_id || '非員工'} • {student.phone}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="info" className="pt-4">
                    <Card className="border-muted/50 bg-muted/5 shadow-none">
                        <CardContent className="p-5 space-y-5 text-sm font-medium">
                            <div className="space-y-2">
                                <h4 className="text-xs font-black text-primary uppercase italic tracking-wider">簡介</h4>
                                <p className="text-foreground/80 leading-relaxed italic text-sm sm:text-base">{course.description}</p>
                            </div>
                            <div className="pt-4 border-t border-muted/30 flex justify-between items-center italic">
                                <span className="text-muted-foreground text-sm">社員報名費</span>
                                <span className="font-black text-primary text-lg">$3,200</span>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
