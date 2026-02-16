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
        <div className="container max-w-5xl py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-8 w-8 rounded-full">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <h1 className="text-xl font-bold tracking-tight">{course.name}</h1>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-xs font-bold border-muted">
                        <Edit2 className="h-3.5 w-3.5 mr-1.5" /> 編輯課程
                    </Button>
                </div>
            </div>

            {/* Compact Info Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-muted/30 p-2.5 rounded-lg flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase font-black text-muted-foreground italic">狀態</span>
                    <Badge variant="outline" className={cn("px-1.5 py-0 h-4 text-[9px] w-fit font-bold rounded-sm border-none shadow-none", status.color)}>
                        {status.label}
                    </Badge>
                </div>
                <div className="bg-muted/30 p-2.5 rounded-lg flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase font-black text-muted-foreground italic">授課老師</span>
                    <span className="text-sm font-bold">{course.teacher}</span>
                </div>
                <div className="bg-muted/30 p-2.5 rounded-lg flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase font-black text-muted-foreground italic">上課時間</span>
                    <span className="text-sm font-bold">{course.startTime} - {course.endTime}</span>
                </div>
                <div className="bg-muted/30 p-2.5 rounded-lg flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase font-black text-muted-foreground italic">地點</span>
                    <span className="text-sm font-bold">{course.room}</span>
                </div>
            </div>

            {/* Tabs Section */}
            <Tabs defaultValue="sessions" className="w-full">
                <TabsList className="w-full justify-start h-9 p-0 bg-transparent border-b rounded-none gap-4">
                    <TabsTrigger value="sessions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 pb-2 text-xs font-bold transition-all">
                        課堂進度 ({course.sessions.length})
                    </TabsTrigger>
                    <TabsTrigger value="students" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 pb-2 text-xs font-bold transition-all">
                        學員名單
                    </TabsTrigger>
                    <TabsTrigger value="info" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-1 pb-2 text-xs font-bold transition-all">
                        課程細節
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="sessions" className="pt-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {course.sessions.map((session) => (
                            <Card key={session.id} className="border-muted hover:bg-muted/5 shadow-none transition-colors">
                                <CardContent className="p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "h-7 w-7 rounded flex items-center justify-center font-black text-[10px]",
                                            session.status === 'completed' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                        )}>
                                            {session.sequence}
                                        </div>
                                        <div>
                                            <p className="font-bold text-xs">
                                                {format(session.date, "M/d (eee)", { locale: zhTW })}
                                            </p>
                                            <p className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
                                                <Users className="h-2.5 w-2.5" /> {session.attendance}/{course.capacity}
                                            </p>
                                        </div>
                                    </div>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-muted-foreground hover:text-primary">
                                        <ClipboardCheck className="h-4 w-4" />
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="students" className="pt-4 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {course.students.map((student) => (
                            <Card key={student.id} className="border-muted/50 shadow-none hover:bg-muted/5">
                                <CardContent className="p-3 flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-3">
                                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                                            {student.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="font-bold">{student.name} {student.role === 'leader' && <Badge className="ml-1 h-3 text-[8px] bg-amber-500">班長</Badge>}</p>
                                            <p className="text-[9px] text-muted-foreground italic font-medium">{student.employee_id || '非員工'} • {student.phone}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="info" className="pt-4">
                    <Card className="border-muted/50 bg-muted/5 shadow-none">
                        <CardContent className="p-4 space-y-4 text-xs font-medium">
                            <div className="space-y-1">
                                <h4 className="text-[10px] font-black text-primary uppercase italic">簡介</h4>
                                <p className="text-foreground/80 leading-relaxed italic">{course.description}</p>
                            </div>
                            <div className="pt-3 border-t border-muted/30 flex justify-between items-center italic">
                                <span className="text-muted-foreground">社員報名費</span>
                                <span className="font-black text-primary">$3,200</span>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
