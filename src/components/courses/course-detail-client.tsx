'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Check,
    Loader2,
    UserPlus,
    UserMinus,
    Shield,
    Star,
    Crown,
    X,
    Edit2,
    ClipboardCheck,
    Plus,
    Save,
    Info,
    ChevronRight,
    ChevronLeft,
    User,
    Clock,
    MapPin,
    Users,
    FileText,
    Calendar as CalendarIcon,
    Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import Link from 'next/link';
import { SessionEnrollmentDialog } from "@/components/courses/session-enrollment-dialog";
import { saveAttendance, assignCourseLeader, removeCourseLeader, submitLeaveRequest, submitTransferRequest, getTransferCandidates } from '@/lib/supabase/actions';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { COURSE_TYPE_LABELS, type CourseType } from '@/types/database';

// Props types
interface MissedSession {
    sessionId: string;
    courseId: string; // Added courseId
    date: string;
    number: number;
    courseName: string;
    teacher: string;
    groupId: string;
}
interface CourseInfo {
    id: string;
    name: string;
    description: string;
    type: string;
    teacher: string;
    room: string;
    startTime: string;
    endTime: string;
    capacity: number;
    cardsPerSession: number;
    status: string;
    leader: string;
    groupTitle: string;
    groupId: string;
    groupUuid: string;
}

interface SessionInfo {
    id: string;
    date: string; // "YYYY-MM-DD"
    number: number;
    isCancelled: boolean;
}

interface StudentInfo {
    id: string;
    name: string;
    role: string;
    isLeader: boolean;
    type: 'official' | 'additional';
    attendance: Record<string, string>; // sessionId -> status
}

type AttendanceMap = Record<string, Record<string, string>>;

interface CourseDetailClientProps {
    course: CourseInfo;
    sessions: SessionInfo[];
    roster: StudentInfo[];
    enrolledCount: number;
    userEnrollment: {
        userId: string;
        enrollmentStatus: {
            isEnrolled: boolean;
            isWaitlisted: boolean;
            waitlistPosition?: number | null;
        }
    };
    cardBalance: number;
    missedSessions: any[];
    canManageAttendance: boolean;
    currentUserRole: string;
    transferMetadata?: Record<string, Record<string, { fromName: string; toName: string }>>;
}

// Status display map
const ATTENDANCE_DISPLAY: Record<string, { label: string; color: string; icon: 'check' | 'x' | 'text' }> = {
    present: { label: 'v', color: 'bg-green-500/10 text-green-600', icon: 'check' },
    absent: { label: 'x', color: 'bg-red-500/10 text-red-500', icon: 'x' },
    leave: { label: '請假', color: 'bg-blue-500/10 text-blue-600', icon: 'text' },
    makeup: { label: '補', color: 'bg-purple-500/10 text-purple-600', icon: 'text' },
    transfer_in: { label: '轉入', color: 'bg-purple-500/10 text-purple-600', icon: 'text' },
    transfer_out: { label: '轉出', color: 'bg-slate-500/10 text-slate-500', icon: 'text' },
    unmarked: { label: '', color: '', icon: 'text' },
};

export function CourseDetailClient({
    course,
    sessions,
    roster,
    enrolledCount,
    userEnrollment,
    cardBalance,
    missedSessions,
    canManageAttendance,
    currentUserRole,
    transferMetadata = {},
}: CourseDetailClientProps) {
    const router = useRouter();
    const isAdminOrLeader = currentUserRole === 'admin' || currentUserRole === 'leader';

    // --- Interaction State ---
    const [isEditing, setIsEditing] = useState(false);
    const [attendanceState, setAttendanceState] = useState<AttendanceMap>(() => {
        const map: AttendanceMap = {};
        for (const student of roster) {
            map[student.id] = { ...student.attendance };
        }
        return map;
    });

    // Sync state with props when roster changes (after router.refresh)
    useEffect(() => {
        const newMap: AttendanceMap = {};
        for (const student of roster) {
            newMap[student.id] = { ...student.attendance };
        }
        setAttendanceState(newMap);
    }, [roster]);

    // Split roster into categories
    const officialStudents = roster.filter(s => s.type === 'official');
    const additionalStudents = roster.filter(s => s.type === 'additional');

    const getPresentCount = (sessionId: string, students: StudentInfo[]) => {
        return students.filter(student => {
            const status = attendanceState[student.id]?.[sessionId] ?? 'unmarked';
            return status === 'present';
        }).length;
    };

    const [isPending, startTransition] = useTransition();
    const [isLeaderDialogOpen, setIsLeaderDialogOpen] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState<StudentInfo | null>(null);

    const isAdmin = currentUserRole === 'admin';

    const toggleLeaderAction = async () => {
        if (!selectedStudent) return;

        startTransition(async () => {
            try {
                if (selectedStudent.isLeader) {
                    await removeCourseLeader(course.id, selectedStudent.id);
                } else {
                    await assignCourseLeader(course.id, selectedStudent.id);
                }
                setIsLeaderDialogOpen(false);
                router.refresh();
            } catch (err) {
                alert(err instanceof Error ? err.message : '操作失敗');
            }
        });
    };

    const [focusedSessionId, setFocusedSessionId] = useState<string | null>(() => {
        const todayStr = format(new Date(), "yyyy-MM-dd");
        return sessions.find(s => s.date === todayStr)?.id || sessions[0]?.id || null;
    });

    // --- Leave/Transfer Dialogs ---
    const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
    const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
    const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);

    const handleLeaveRequest = async () => {
        if (!selectedSession) return;

        // Optimistic update
        const sessionId = selectedSession.id;
        const userId = userEnrollment.userId;
        setAttendanceState((prev: AttendanceMap) => ({
            ...prev,
            [userId]: { ...prev[userId], [sessionId]: 'leave' }
        }));

        startTransition(async () => {
            try {
                const res = await submitLeaveRequest(course.id, sessionId);
                alert(res.message);
                setIsLeaveDialogOpen(false);
                router.refresh();
            } catch (err) {
                // Rollback on error
                router.refresh(); // Fetch true state again
                alert(err instanceof Error ? err.message : '操作失敗');
            }
        });
    };

    const handleTransferRequest = async (toUserId: string | null) => {
        if (!selectedSession) return;

        // Optimistic update
        const sessionId = selectedSession.id;
        const fromUserId = userEnrollment.userId;
        setAttendanceState((prev: AttendanceMap) => {
            const next = { ...prev };
            next[fromUserId] = { ...next[fromUserId], [sessionId]: 'transfer_out' };
            if (toUserId) {
                next[toUserId] = { ...next[toUserId], [sessionId]: 'transfer_in' };
            }
            return next;
        });

        startTransition(async () => {
            try {
                const res = await submitTransferRequest(course.id, sessionId, toUserId);
                alert(res.message);
                setIsTransferDialogOpen(false);
                setTransferStep('pick');
                setSelectedTransferUser(null);
                router.refresh();
            } catch (err) {
                // Rollback on error
                router.refresh();
                alert(err instanceof Error ? err.message : '操作失敗');
            }
        });
    };

    // Transfer user picker state
    const [transferStep, setTransferStep] = useState<'pick' | 'confirm'>('pick');
    const [transferCandidates, setTransferCandidates] = useState<{
        waitlist: { id: string; name: string; role: string; position: number }[];
        allMembers: { id: string; name: string; role: string }[];
    }>({ waitlist: [], allMembers: [] });
    const [selectedTransferUser, setSelectedTransferUser] = useState<{ id: string; name: string; role: string } | null>(null);
    const [transferSearch, setTransferSearch] = useState('');
    const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);

    const openTransferDialog = async (session: SessionInfo) => {
        setSelectedSession(session);
        setTransferStep('pick');
        setSelectedTransferUser(null);
        setTransferSearch('');
        setIsTransferDialogOpen(true);
        setIsLoadingCandidates(true);
        try {
            const candidates = await getTransferCandidates(course.id);
            setTransferCandidates(candidates);
        } catch (err) {
            console.error('Failed to load candidates', err);
        } finally {
            setIsLoadingCandidates(false);
        }
    };

    const filteredMembers = transferCandidates.allMembers.filter(m =>
        m.name.toLowerCase().includes(transferSearch.toLowerCase())
    );

    // Helper: determine the "original type" of a student for a session
    // Uses transferMetadata (from transfer_requests table) as authoritative source
    const getOriginalType = (studentId: string, sessionId: string): string => {
        const meta = transferMetadata[sessionId]?.[studentId];
        const dbStatus = roster.find(r => r.id === studentId)?.attendance[sessionId] ?? 'unmarked';
        const isOfficial = officialStudents.some(s => s.id === studentId);

        // Check transfer_requests table first (survives saves)
        if (meta) {
            // Determine if this student is the sender or receiver
            if (isOfficial && (dbStatus === 'transfer_out' || dbStatus === 'leave')) {
                return 'transfer_out';
            }
            // If they're an additional student with transfer metadata, they're the receiver
            if (!isOfficial) return 'transfer_in';
            // Official student with transfer metadata but not transfer_out — could be transfer_out that was marked
            if (dbStatus === 'transfer_out') return 'transfer_out';
        }
        if (dbStatus === 'transfer_out') return 'transfer_out';
        if (dbStatus === 'transfer_in') return 'transfer_in';
        if (dbStatus === 'makeup') return 'makeup';
        if (dbStatus === 'leave') return 'leave';
        if (!isOfficial) return 'single';
        return 'normal';
    };

    // Toggle attendance: pending -> present -> absent -> restore original
    const toggleAttendance = (studentId: string, sessionId: string) => {
        const origType = getOriginalType(studentId, sessionId);
        setAttendanceState((prev: AttendanceMap) => {
            const current = prev[studentId]?.[sessionId] ?? 'unmarked';
            if (current === 'leave' || current === 'transfer_out') return prev;

            let next: string;
            // Treat transfer_in/makeup/unmarked as "pending" for toggle
            if (current === 'unmarked' || current === '' || current === 'transfer_in' || current === 'makeup') next = 'present';
            else if (current === 'present') next = 'absent';
            else {
                // Restore to logical original: transfer_in, makeup, or unmarked
                if (origType === 'transfer_in') next = 'transfer_in';
                else if (origType === 'makeup') next = 'makeup';
                else next = 'unmarked';
            }

            return {
                ...prev,
                [studentId]: { ...prev[studentId], [sessionId]: next },
            };
        });
    };

    // Save attendance
    const handleSave = () => {
        if (!focusedSessionId) return;

        // Only save records that are NOT protected (leave, transfer_out)
        const records = roster
            .filter(s => {
                const origType = getOriginalType(s.id, focusedSessionId);
                return origType !== 'leave' && origType !== 'transfer_out';
            })
            .map(s => ({
                userId: s.id,
                status: attendanceState[s.id]?.[focusedSessionId] ?? 'unmarked',
            }));

        startTransition(async () => {
            await saveAttendance(focusedSessionId, records);
            setIsEditing(false);
        });
    };

    const handleCancel = () => {
        // Reset to original data
        const map: Record<string, Record<string, string>> = {};
        for (const student of roster) {
            map[student.id] = { ...student.attendance };
        }
        setAttendanceState(map);
        setIsEditing(false);
    };

    const toggleFocus = (sessionId: string) => {
        setFocusedSessionId(focusedSessionId === sessionId ? null : sessionId);
    };

    const renderAttendanceCell = (status: string, studentId: string, sessionId: string) => {
        const origType = getOriginalType(studentId, sessionId);
        const canEdit = isEditing && origType !== 'leave' && origType !== 'transfer_out';
        const isOfficialStudent = officialStudents.some(s => s.id === studentId);

        // Determine type label using getOriginalType (authoritative, survives saves)
        let typeLabel = "";
        if (origType === 'transfer_out') {
            const meta = transferMetadata[sessionId]?.[studentId];
            typeLabel = meta ? `轉讓 ${meta.toName}` : "轉讓";
        } else if (origType === 'transfer_in') {
            const meta = transferMetadata[sessionId]?.[studentId];
            typeLabel = meta ? `${meta.fromName} 轉讓` : "轉入";
        } else if (origType === 'makeup') {
            typeLabel = "補";
        } else if (origType === 'single') {
            typeLabel = "單";
        }

        // Determine dynamic color for label when checked
        const getLabelColor = () => {
            if (status === 'unmarked') return "text-white/40";
            if (status === 'present') return "text-emerald-500";
            if (status === 'absent') return "text-rose-500";
            if (status === 'leave') return "text-blue-500";
            if (status === 'transfer_out') return "text-purple-400";
            return "text-white/70";
        };

        return (
            <div
                onClick={canEdit ? () => toggleAttendance(studentId, sessionId) : undefined}
                className={cn(
                    "w-full h-full flex flex-col items-center justify-center transition-all duration-200 relative",
                    status === 'present' ? "bg-emerald-500/20" :
                        status === 'absent' ? "bg-rose-500/20" :
                            (status === 'leave' || origType === 'leave') ? "bg-blue-500/20" :
                                (status === 'transfer_out' || origType === 'transfer_out') ? "bg-purple-500/20" : "bg-transparent",
                    canEdit && "cursor-pointer hover:brightness-125 active:scale-95 group/cell"
                )}
            >
                {/* Main Content */}
                {status === 'unmarked' ? (
                    typeLabel ? (
                        <span className="text-xs font-bold text-white/40">{typeLabel}</span>
                    ) : (
                        <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                    )
                ) : (
                    <div className="flex flex-col items-center justify-center gap-0.5">
                        <span className={cn(
                            "text-xs font-bold px-1 text-center leading-none",
                            status === 'present' ? "text-emerald-500 font-black" :
                                status === 'absent' ? "text-rose-500 font-black" :
                                    status === 'leave' ? "text-blue-500 font-black" :
                                        status === 'transfer_out' ? "text-purple-400" :
                                            (status === 'transfer_in' || status === 'makeup') ? "text-white/40" : "text-white/40"
                        )}>
                            {status === 'present' ? <Check className="h-4 w-4 stroke-[4px]" /> :
                                status === 'absent' ? <X className="h-4 w-4 stroke-[4px]" /> :
                                    status === 'leave' ? "請假" :
                                        (status === 'transfer_out' || status === 'transfer_in' || status === 'makeup') ? typeLabel :
                                            <div className="w-1.5 h-1.5 rounded-full bg-white/10" />}
                        </span>

                        {/* Sub-label for marked cells (Additional students only) */}
                        {typeLabel && (status === 'present' || status === 'absent') && (
                            <span className={cn("text-[8px] font-black leading-none", getLabelColor())}>
                                {typeLabel}
                            </span>
                        )}
                    </div>
                )}

                {/* Edit Indicator */}
                {canEdit && (
                    <div className="absolute top-1 right-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                    </div>
                )}
            </div>
        );
    };

    const todayStr = format(new Date(), "yyyy-MM-dd");

    return (
        <div className="container max-w-5xl py-6 space-y-5">
            {/* Header Area */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1 min-w-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.back()}
                        className="h-10 w-10 rounded-full shrink-0"
                    >
                        <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <div className="flex flex-col min-w-0">
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate leading-none">{course.name}</h1>
                        {course.groupTitle && (
                            <p className="text-xs sm:text-sm text-muted-foreground font-medium mt-1 truncate">
                                {course.groupTitle}
                            </p>
                        )}
                    </div>
                </div>

                {isAdminOrLeader && (
                    <div className="flex items-center gap-2 shrink-0">
                        <Link href={`/courses/groups/${course.groupId}/${course.id}/edit`}>
                            <Button className="h-9 px-3 sm:px-4 text-sm font-bold bg-white text-black hover:bg-white/90 shadow-lg rounded-lg transition-all active:scale-95">
                                <Edit2 className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">編輯課程</span>
                            </Button>
                        </Link>
                    </div>
                )}
            </div>

            {/* Block 1: Metadata and Description */}
            <div className="p-5 bg-muted/20 border border-muted/50 rounded-2xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex flex-col gap-4 text-foreground flex-1">
                        {course.type && COURSE_TYPE_LABELS[course.type as CourseType] && (
                            <div className="flex items-center">
                                <Badge variant="outline" className="px-2 py-0.5 text-xs font-bold rounded-md border-none ring-1 ring-inset bg-muted/20 text-muted-foreground/90 ring-muted-foreground/10 uppercase tracking-wider">
                                    {COURSE_TYPE_LABELS[course.type as CourseType]}
                                </Badge>
                            </div>
                        )}
                        <div className="flex flex-col gap-3">
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
                                <span className="text-sm font-medium">時間: <span className="font-bold ml-1">{course.startTime}~{course.endTime}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <MapPin className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">地點: <span className="font-bold ml-1">{course.room}</span></span>
                            </div>
                            <div className="flex items-center gap-3">
                                <Users className="h-5 w-5 text-muted-foreground/80 shrink-0" />
                                <span className="text-sm font-medium">名額: <span className="font-bold ml-1">{enrolledCount}/{course.capacity} 人</span></span>
                            </div>
                        </div>
                    </div>

                    {/* Enrollment Action */}
                    <div className="w-full md:w-44 shrink-0 mt-4 md:mt-0">
                        {userEnrollment.enrollmentStatus.isEnrolled ? (
                            <div className="flex flex-col items-stretch gap-2">
                                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted/20 text-muted-foreground border border-muted-foreground/10">
                                    <Check className="h-4 w-4 shrink-0" />
                                    <span className="text-sm font-bold">待出席</span>
                                </div>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:bg-transparent hover:text-destructive font-medium justify-center transition-colors">
                                            <UserMinus className="h-3.5 w-3.5 mr-1" />
                                            取消報名
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>確認取消報名？</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                取消後你的名額將釋出給候補學員。
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>返回</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleCancel} disabled={isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                                確認取消
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        ) : userEnrollment.enrollmentStatus.isWaitlisted ? (
                            <div className="flex flex-col items-stretch gap-2">
                                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500/10 text-orange-600 border border-orange-500/20">
                                    <Clock className="h-4 w-4 shrink-0" />
                                    <span className="text-sm font-bold">候補中{userEnrollment.enrollmentStatus.waitlistPosition ? ` 第${userEnrollment.enrollmentStatus.waitlistPosition}位` : ''}</span>
                                </div>
                                <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isPending} className="text-xs text-muted-foreground hover:bg-transparent hover:text-destructive font-medium justify-center transition-colors">
                                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserMinus className="h-3.5 w-3.5 mr-1" />}
                                    取消候補
                                </Button>
                            </div>
                        ) : (
                            <SessionEnrollmentDialog
                                courseId={course.id}
                                courseName={course.name}
                                teacher={course.teacher}
                                groupId={course.groupUuid}
                                cardBalance={cardBalance}
                                sessions={sessions.map(s => ({
                                    id: s.id,
                                    session_date: s.date,
                                    session_number: s.number
                                }))}
                                missedSessions={missedSessions}
                                isFull={enrolledCount >= course.capacity}
                                enrolledCount={enrolledCount}
                                capacity={course.capacity}
                            />
                        )}
                    </div>
                </div>

                {course.description && (
                    <div className="mt-4 pt-6 border-t border-muted/50">
                        <h3 className="text-sm font-bold text-foreground/90 mb-2 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary/70" />
                            課程描述
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {course.description}
                        </p>
                    </div>
                )}
            </div>

            {/* Block 2: My Attendance Progress (Leave/Transfer) */}
            {userEnrollment.enrollmentStatus.isEnrolled && (
                <div className="pt-5 pb-3 bg-muted/20 border border-muted/50 rounded-2xl space-y-4">
                    <div className="px-5 flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground/90">
                                <CalendarIcon className="h-4 w-4 text-primary" />
                                請假/轉讓
                            </h3>
                            {course.type === 'normal' && (() => {
                                const myAttendanceRecord = roster.find(s => s.id === userEnrollment.userId)?.attendance || {};
                                const usedTransfers = Object.values(myAttendanceRecord).filter(v => v === 'transfer_out').length;
                                const usedMakeups = Object.values(myAttendanceRecord).filter(v => v === 'makeup').length;
                                const totalUsed = usedTransfers + usedMakeups;
                                const quota = Math.ceil(sessions.length / 4);
                                return (
                                    <p className="text-[11px] text-muted-foreground font-medium pl-6">
                                        剩餘額度: <span className={cn("font-bold", totalUsed >= quota ? "text-rose-500" : "text-primary")}>{totalUsed}</span>/{quota} 次 (補課+轉讓)
                                    </p>
                                );
                            })()}
                        </div>
                        <span className="text-[11px] text-muted-foreground font-medium">共 {sessions.length} 堂課</span>
                    </div>

                    {/* Horizontal Scrollable Slider - Outer wrapper provides the left/right margin */}
                    <div className="px-5">
                        <div className="flex gap-4 overflow-x-auto pb-3 snap-x custom-scrollbar">
                            {sessions.map((session) => {
                                const myAttendance = roster.find(s => s.id === userEnrollment.userId)?.attendance?.[session.id] || 'unmarked';
                                const isPast = new Date(session.date) < new Date(todayStr);
                                const isToday = session.date === todayStr;
                                const sessionDate = parseISO(session.date);

                                // Quota calculation for disabling buttons
                                const myAttendanceRecord = roster.find(s => s.id === userEnrollment.userId)?.attendance || {};
                                const usedTransfers = Object.values(myAttendanceRecord).filter(v => v === 'transfer_out').length;
                                const usedMakeups = Object.values(myAttendanceRecord).filter(v => v === 'makeup').length;
                                const totalUsed = usedTransfers + usedMakeups;
                                const quota = Math.ceil(sessions.length / 4);

                                // Freeze logic: session in the past, or already has any status in DB (including present/absent)
                                const isFrozen = isPast || myAttendance !== 'unmarked';

                                // User reached quota for 'normal' courses
                                const quotaReached = course.type === 'normal' && totalUsed >= quota;

                                return (
                                    <div key={session.id} className={cn(
                                        "flex flex-col shrink-0 w-[160px] snap-start rounded-2xl transition-all duration-300 overflow-hidden backdrop-blur-md border shadow-2xl group relative",
                                        isFrozen
                                            ? "bg-neutral-900 border-white/5 shadow-none"
                                            : isToday
                                                ? "bg-gradient-to-br from-primary/30 to-primary/10 border-primary/40 ring-1 ring-primary/20 shadow-primary/10 hover:border-primary/60 cursor-pointer"
                                                : "bg-gradient-to-br from-white/[0.08] to-white/[0.01] border-white/[0.1] hover:border-white/[0.3] shadow-black/20 cursor-pointer"
                                    )}>
                                        {/* Original Card Content Area */}
                                        <div className="p-4 flex flex-col items-center text-center space-y-4">
                                            {/* Session Number & Badge */}
                                            <div className="flex items-center justify-between w-full">
                                                <div className={cn(
                                                    "h-6 px-2 rounded-md flex items-center justify-center font-bold text-[10px]",
                                                    isFrozen ? "bg-white/[0.02] text-muted-foreground/30" : isToday ? "bg-primary text-primary-foreground" : "bg-white/[0.1] text-foreground"
                                                )}>
                                                    堂 {session.number}
                                                </div>
                                                <Badge variant="ghost" className={cn("h-4 p-0 text-[10px] uppercase font-black tracking-widest bg-transparent border-none shadow-none",
                                                    myAttendance === 'leave' ? "text-blue-500" :
                                                        myAttendance === 'transfer_out' ? "text-purple-400" :
                                                            isFrozen ? "text-muted-foreground/30" : ATTENDANCE_DISPLAY[myAttendance]?.color)}>
                                                    {myAttendance === 'leave' ? "請假" :
                                                        myAttendance === 'transfer_out' ? "轉出" :
                                                            ATTENDANCE_DISPLAY[myAttendance]?.label || (isPast ? "已結束" : "待出席")}
                                                </Badge>
                                            </div>

                                            {/* Main Date Display */}
                                            <div className="space-y-1 pb-1">
                                                <p className={cn("text-base font-bold tracking-tight", isFrozen ? "text-muted-foreground/30" : "text-white")}>
                                                    {format(sessionDate, "MM/dd")}
                                                </p>
                                                <div className={cn("h-1 w-8 mx-auto rounded-full", isFrozen ? "bg-white/[0.02]" : "bg-primary/20")} />
                                            </div>
                                        </div>

                                        {/* Actions at bottom - Consistently show buttons but disable if frozen or quota reached */}
                                        <div className="mt-auto grid grid-cols-2 border-t border-white/[0.08] bg-white/[0.02] transition-colors group-hover:bg-white/[0.07]">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={isFrozen || quotaReached || isPending}
                                                className={cn(
                                                    "h-10 rounded-none text-[11px] font-bold border-r border-white/[0.08] transition-all",
                                                    (isFrozen || quotaReached) ? "text-muted-foreground/20" : "text-blue-400 hover:bg-blue-500/20 hover:text-blue-300"
                                                )}
                                                onClick={() => {
                                                    setSelectedSession(session);
                                                    setIsLeaveDialogOpen(true);
                                                }}
                                            >
                                                請假
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={isFrozen || quotaReached || isPending}
                                                className={cn(
                                                    "h-10 rounded-none text-[11px] font-bold transition-all",
                                                    (isFrozen || quotaReached) ? "text-muted-foreground/20" : "text-purple-400 hover:bg-purple-500/20 hover:text-purple-300"
                                                )}
                                                onClick={() => openTransferDialog(session)}
                                            >
                                                轉讓
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}


            {/* Block 3: Attendance Roster View */}
            <div className="space-y-4">
                <div className="flex justify-between items-center px-5">
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
                                                onClick={handleCancel}
                                                className="h-7 px-3 text-xs font-bold border-white/10 hover:bg-white/5 hover:text-white transition-all text-white/70"
                                            >
                                                取消
                                            </Button>
                                            <Button
                                                size="sm"
                                                onClick={handleSave}
                                                disabled={isPending}
                                                className="h-7 px-4 text-xs font-black bg-white text-black hover:bg-white/90 shadow-md rounded-lg transition-all active:scale-95"
                                            >
                                                {isPending ? '儲存中...' : '儲存'}
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
                    {/* Scroll hint shadow - Adjusted for vertical scroll */}
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background/80 via-background/20 to-transparent z-20" />

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse table-fixed min-w-[500px]">
                            <thead className="sticky top-0 z-50">
                                <tr className="bg-muted/10 border-b border-muted backdrop-blur-md">
                                    <th className="p-3 text-xs font-black uppercase text-muted-foreground italic sticky left-0 top-0 bg-card/95 backdrop-blur-sm z-[60] w-[140px] border-r border-muted/50 shadow-[4px_0_10px_-5px_rgba(0,0,0,0.1)]">
                                        姓名
                                    </th>
                                    {sessions.map(s => {
                                        const totalPresent = getPresentCount(s.id, roster);
                                        const totalEnrolled = roster.filter(st => st.type === 'official' || (attendanceState[st.id]?.[s.id] && attendanceState[st.id]?.[s.id] !== 'unmarked')).length;

                                        const isFocused = focusedSessionId === s.id;
                                        const isToday = s.date === todayStr;
                                        const sessionDate = parseISO(s.date);

                                        return (
                                            <th
                                                key={s.id}
                                                onClick={() => toggleFocus(s.id)}
                                                className={cn(
                                                    "p-2 text-center border-r border-muted/30 last:border-0 w-[100px] transition-all cursor-pointer relative group/header overflow-visible",
                                                    isFocused ? "z-30 bg-white/5" : "hover:bg-muted/5"
                                                )}
                                            >
                                                {isFocused && (
                                                    <div className="absolute inset-x-0 top-0 h-1 bg-white" />
                                                )}

                                                <div className="flex flex-col items-center gap-1 relative py-1">
                                                    <span className={cn(
                                                        "text-sm font-black tracking-tight transition-colors",
                                                        isFocused ? "text-white" : "text-muted-foreground group-hover/header:text-white"
                                                    )}>
                                                        {format(sessionDate, "M/d")}
                                                    </span>

                                                    <div className={cn(
                                                        "flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full transition-all",
                                                        isFocused ? "bg-white/10 text-white" : "text-muted-foreground/40"
                                                    )}>
                                                        <Users className="h-2.5 w-2.5" />
                                                        {totalPresent}
                                                    </div>
                                                </div>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="z-10 relative">
                                {/* Official Students Section */}
                                <tr className="bg-muted/5">
                                    <td colSpan={sessions.length + 1} className="px-3 py-2 text-[11px] font-black text-muted-foreground uppercase tracking-widest border-b border-muted/20">
                                        常態學員
                                    </td>
                                </tr>
                                {officialStudents.length === 0 ? (
                                    <tr className="border-b border-muted/20">
                                        <td colSpan={sessions.length + 1} className="py-8 text-center text-xs text-muted-foreground italic">尚無常態學員</td>
                                    </tr>
                                ) : (
                                    officialStudents
                                        .sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0))
                                        .map((student) => (
                                            <tr key={student.id} className="border-b border-muted/10 hover:bg-white/[0.02] transition-colors group">
                                                <td className="p-3 text-xs font-bold sticky left-0 bg-card/95 backdrop-blur-sm z-30 border-r border-muted/50">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold">{student.name}</span>
                                                        {student.isLeader && (
                                                            <Crown className="h-3.5 w-3.5 text-white fill-white/10" />
                                                        )}
                                                    </div>
                                                </td>
                                                {sessions.map(s => {
                                                    const status = attendanceState[student.id]?.[s.id] ?? 'unmarked';
                                                    const isFocused = focusedSessionId === s.id;
                                                    return (
                                                        <td key={s.id} className={cn(
                                                            "p-0 border-r border-muted/10 last:border-0 h-14 transition-all relative",
                                                            isFocused && "bg-white/[0.03]"
                                                        )}>
                                                            {renderAttendanceCell(status, student.id, s.id)}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))
                                )}

                                {/* Additional Students Section */}
                                <tr className="bg-muted/5">
                                    <td colSpan={sessions.length + 1} className="px-3 py-2 text-[11px] font-black text-muted-foreground uppercase tracking-widest border-b border-muted/20 border-t border-muted/20 mt-4">
                                        加報學員 ({focusedSessionId ? format(parseISO(sessions.find(s => s.id === focusedSessionId)?.date || ''), "M/d") : ''} 名單)
                                    </td>
                                </tr>
                                {additionalStudents.filter(s => {
                                    const currentStatus = attendanceState[s.id]?.[focusedSessionId || ''];
                                    const initialStatus = roster.find(r => r.id === s.id)?.attendance[focusedSessionId || ''] ?? 'unmarked';
                                    // Stay visible if they started with a status OR currently have one
                                    return (currentStatus && currentStatus !== 'unmarked') || (initialStatus && initialStatus !== 'unmarked');
                                }).length === 0 ? (
                                    <tr className="border-b border-muted/20">
                                        <td colSpan={sessions.length + 1} className="py-8 text-center text-xs text-muted-foreground italic">該堂無加報學員</td>
                                    </tr>
                                ) : (
                                    additionalStudents
                                        .filter(s => {
                                            const currentStatus = attendanceState[s.id]?.[focusedSessionId || ''];
                                            const initialStatus = roster.find(r => r.id === s.id)?.attendance[focusedSessionId || ''] ?? 'unmarked';
                                            return (currentStatus && currentStatus !== 'unmarked') || (initialStatus && initialStatus !== 'unmarked');
                                        })
                                        .map((student) => (
                                            <tr key={student.id} className="border-b border-muted/10 hover:bg-white/[0.02] transition-colors group">
                                                <td className="p-3 text-xs font-bold sticky left-0 bg-card/95 backdrop-blur-sm z-30 border-r border-muted/50">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold">{student.name}</span>
                                                    </div>
                                                </td>
                                                {sessions.map(s => {
                                                    const status = attendanceState[student.id]?.[s.id] ?? 'unmarked';
                                                    const isFocused = focusedSessionId === s.id;
                                                    return (
                                                        <td key={s.id} className={cn(
                                                            "p-0 border-r border-muted/10 last:border-0 h-14 transition-all relative",
                                                            isFocused && "bg-white/[0.03]"
                                                        )}>
                                                            {renderAttendanceCell(status, student.id, s.id)}
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

            {/* Dialogs */}
            <AlertDialog open={isLeaveDialogOpen} onOpenChange={setIsLeaveDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>申請請假</AlertDialogTitle>
                        <AlertDialogDescription asChild className="space-y-4">
                            <div>
                                <p>
                                    確定要申請 {selectedSession && format(parseISO(selectedSession.date), "MM/dd")} 的課程請假嗎？
                                    請假名額將釋出給補課或轉入的同學。
                                </p>
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 leading-relaxed">
                                    <p className="font-bold mb-1">⚠️ 注意：</p>
                                    <p>請假手續一旦完成即無法撤回或修改，請確認後再提交。</p>
                                </div>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>返回</AlertDialogCancel>
                        <AlertDialogAction onClick={handleLeaveRequest} disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            確認請假
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={isTransferDialogOpen} onOpenChange={(open) => {
                setIsTransferDialogOpen(open);
                if (!open) {
                    setTransferStep('pick');
                    setSelectedTransferUser(null);
                    setTransferSearch('');
                }
            }}>
                <DialogContent className="sm:max-w-[480px] max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            {transferStep === 'pick' ? '選擇接手學員' : '確認轉讓'}
                        </DialogTitle>
                        <DialogDescription>
                            {transferStep === 'pick'
                                ? `將 ${selectedSession ? format(parseISO(selectedSession.date), "MM/dd") : ''} 的課程名額轉讓給指定學員`
                                : `確定要將名額轉讓給 ${selectedTransferUser?.name} 嗎？`}
                        </DialogDescription>
                    </DialogHeader>

                    {transferStep === 'pick' ? (
                        <div className="flex-1 overflow-y-auto space-y-4 py-2">
                            {isLoadingCandidates ? (
                                <div className="flex items-center justify-center py-10">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : (
                                <>
                                    {/* Waitlist Section */}
                                    {transferCandidates.waitlist.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">
                                                候補名單（優先）
                                            </h4>
                                            <div className="space-y-1">
                                                {transferCandidates.waitlist.map((user) => (
                                                    <button
                                                        key={user.id}
                                                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10 transition-colors text-left group"
                                                        onClick={() => {
                                                            setSelectedTransferUser(user);
                                                            setTransferStep('confirm');
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-full bg-orange-500/20 flex items-center justify-center text-xs font-bold text-orange-400">
                                                                {user.position}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-foreground">{user.name}</p>
                                                                <p className="text-[10px] text-muted-foreground">候補第 {user.position} 名</p>
                                                            </div>
                                                        </div>
                                                        <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-foreground transition-colors" />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* All Members Section */}
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">
                                            {transferCandidates.waitlist.length > 0 ? '或選擇其他社員' : '全部社員'}
                                        </h4>
                                        {/* Search */}
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                                            <input
                                                type="text"
                                                placeholder="搜尋社員姓名..."
                                                value={transferSearch}
                                                onChange={(e) => setTransferSearch(e.target.value)}
                                                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-muted/50 bg-muted/10 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-all"
                                            />
                                        </div>
                                        <div className="max-h-[240px] overflow-y-auto space-y-1 custom-scrollbar">
                                            {filteredMembers.length === 0 ? (
                                                <p className="text-center text-sm text-muted-foreground/50 py-6">找不到符合的社員</p>
                                            ) : (
                                                filteredMembers.slice(0, 50).map((user) => (
                                                    <button
                                                        key={user.id}
                                                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-transparent hover:border-muted/50 hover:bg-muted/10 transition-colors text-left group"
                                                        onClick={() => {
                                                            setSelectedTransferUser(user);
                                                            setTransferStep('confirm');
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-full bg-muted/30 flex items-center justify-center text-xs font-bold text-foreground/70">
                                                                {user.name.charAt(0)}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-medium text-foreground">{user.name}</p>
                                                                <p className="text-[10px] text-muted-foreground">
                                                                    {user.role === 'guest' ? '非社員' : '社員'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-foreground transition-colors" />
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        /* Confirm Step */
                        <div className="space-y-4 py-2">
                            <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-muted/30">
                                <div className="h-12 w-12 rounded-full bg-purple-500/20 flex items-center justify-center text-lg font-bold text-purple-400">
                                    {selectedTransferUser?.name.charAt(0)}
                                </div>
                                <div>
                                    <p className="text-base font-bold">{selectedTransferUser?.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {selectedTransferUser?.role === 'guest' ? '非社員' : '社員'}
                                    </p>
                                </div>
                            </div>

                            {selectedTransferUser?.role === 'guest' && (
                                <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-xs text-orange-400 leading-relaxed">
                                    <p className="font-bold mb-1">⚠️ 非社員轉讓提醒：</p>
                                    <p>接手人為非社員，需補繳差額堂卡。目前需由幹部手動處理，轉讓後請主動告知幹部。</p>
                                </div>
                            )}

                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 leading-relaxed">
                                <p className="font-bold mb-1">⚠️ 重要提醒：</p>
                                <p>轉讓手續一旦完成即無法撤回或修改，名額將直接移交給接手學員，請再次確認資訊無誤。</p>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 mt-2">
                        {transferStep === 'confirm' ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => setTransferStep('pick')}
                                    className="w-full sm:w-auto font-bold border-white/10 hover:bg-white/5"
                                >
                                    返回選擇
                                </Button>
                                <Button
                                    onClick={() => handleTransferRequest(selectedTransferUser?.id ?? null)}
                                    disabled={isPending}
                                    className="w-full sm:w-auto font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-lg transition-all active:scale-95"
                                >
                                    {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                    確認轉讓
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="outline"
                                onClick={() => setIsTransferDialogOpen(false)}
                                className="w-full sm:w-auto font-bold border-white/10 hover:bg-white/5"
                            >
                                取消
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isLeaderDialogOpen} onOpenChange={setIsLeaderDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>{selectedStudent?.isLeader ? '移除班長權限' : '指派為班長'}</DialogTitle>
                        <DialogDescription>
                            {selectedStudent ? (
                                selectedStudent.isLeader
                                    ? `確定要移除 ${selectedStudent.name} 的班長權限嗎？`
                                    : `確定要將 ${selectedStudent.name} 指派為本堂課的班長嗎？班長將擁有點名權限。`
                            ) : null}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
                        <Button
                            variant="outline"
                            onClick={() => setIsLeaderDialogOpen(false)}
                            className="w-full sm:w-auto font-bold border-white/10 hover:bg-white/5"
                        >
                            取消
                        </Button>
                        <Button
                            variant={selectedStudent?.isLeader ? "destructive" : "default"}
                            onClick={toggleLeaderAction}
                            disabled={isPending}
                            className={cn(
                                "w-full sm:w-auto font-bold shadow-lg transition-all active:scale-95",
                                !selectedStudent?.isLeader && "bg-white text-black hover:bg-white/90"
                            )}
                        >
                            {isPending ? (
                                <span className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 animate-spin" />
                                    處理中...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    {selectedStudent?.isLeader ? (
                                        <X className="h-4 w-4" />
                                    ) : (
                                        <Crown className="h-4 w-4" />
                                    )}
                                    {selectedStudent?.isLeader ? '確認移除' : '確認指派'}
                                </span>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div >
    );
}
