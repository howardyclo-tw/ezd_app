'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Loader2,
    UserPlus,
    Calendar,
    Check,
    AlertCircle,
    ArrowRight,
    Search,
    Info,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { batchEnrollInSessions, submitMakeupRequest } from '@/lib/supabase/actions';
import { toast } from 'sonner';

interface Session {
    id: string;
    session_date: string;
    session_number: number;
}

interface MissedSession {
    sessionId: string;
    courseId: string;
    date: string;
    number: number;
    courseName: string;
    teacher: string;
    groupId: string;
}

interface SessionEnrollmentDialogProps {
    courseId: string;
    courseName: string;
    teacher: string;
    groupId: string;
    cardBalance: number;
    sessions: Session[];
    missedSessions: MissedSession[];
    isFull: boolean;
    enrolledCount: number;
    capacity: number;
}

export function SessionEnrollmentDialog({
    courseId,
    courseName,
    teacher,
    groupId,
    cardBalance,
    sessions,
    missedSessions,
    isFull,
    enrolledCount,
    capacity,
}: SessionEnrollmentDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<'selection' | 'enroll' | 'makeup'>('selection');
    const [selectedTargetSessionIds, setSelectedTargetSessionIds] = useState<Set<string>>(new Set());
    const [selectedOriginalSessionId, setSelectedOriginalSessionId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    // Filter missed sessions to only include those from the SAME group (period)
    const availableQuota = missedSessions.filter(ms => ms.groupId === groupId);

    const toggleTargetSession = (id: string) => {
        const next = new Set(selectedTargetSessionIds);
        if (mode === 'enroll') {
            if (next.has(id)) next.delete(id);
            else next.add(id);
        } else {
            // Makeup mode is 1-to-1
            next.clear();
            next.add(id);
        }
        setSelectedTargetSessionIds(next);
    };

    const originalSession = availableQuota.find(s => s.sessionId === selectedOriginalSessionId);

    const handleBatchEnroll = () => {
        if (selectedTargetSessionIds.size === 0) return;

        startTransition(async () => {
            try {
                const res = await batchEnrollInSessions(courseId, Array.from(selectedTargetSessionIds));
                if (res.success) {
                    toast.success(res.message);
                    setIsOpen(false);
                    router.refresh();
                } else {
                    toast.error(res.message);
                }
            } catch (err) {
                toast.error(err instanceof Error ? err.message : '報名失敗');
            }
        });
    };

    const handleMakeupSubmit = () => {
        const targetId = Array.from(selectedTargetSessionIds)[0];
        if (!targetId || !selectedOriginalSessionId || !originalSession) return;

        startTransition(async () => {
            try {
                const res = await submitMakeupRequest(
                    originalSession.courseId,
                    selectedOriginalSessionId,
                    courseId,
                    targetId
                );
                if (res.success) {
                    toast.success(res.message);
                    setIsOpen(false);
                    router.refresh();
                } else {
                    toast.error(res.message);
                }
            } catch (err) {
                toast.error(err instanceof Error ? err.message : '申請失敗');
            }
        });
    };

    const reset = () => {
        setMode('selection');
        setSelectedTargetSessionIds(new Set());
        setSelectedOriginalSessionId(null);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) reset(); }}>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    className={cn(
                        "w-full h-11 text-sm font-black rounded-xl border transition-all active:scale-[0.98]",
                        "bg-orange-500/10 border-orange-500/30 text-orange-500",
                        "hover:bg-orange-500/20 hover:border-orange-500/50 hover:text-orange-500",
                        "dark:hover:bg-orange-500/20",
                        isFull && "opacity-90"
                    )}
                >
                    <UserPlus className="h-4 w-4 mr-2" />
                    <span>{isFull ? '加入候補' : '單堂報名 / 補課'}</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden rounded-3xl border border-muted-foreground/10 shadow-2xl bg-background">
                <DialogHeader className="p-8 pb-4">
                    <DialogTitle className="text-2xl font-black tracking-tight">
                        {mode === 'selection' ? '選擇加入方式' :
                            mode === 'enroll' ? '確認單堂報名' : '補課申請'}
                    </DialogTitle>
                    <DialogDescription className="text-base font-medium text-muted-foreground/80 mt-2">
                        {courseName} ({teacher})
                    </DialogDescription>
                </DialogHeader>

                <div className="px-8 py-4 space-y-6">
                    {/* Mode Selection */}
                    {mode === 'selection' && (
                        <div className="grid gap-4">
                            <div
                                onClick={() => setMode('enroll')}
                                className="flex items-center gap-5 p-5 rounded-2xl border-2 border-transparent bg-muted/5 hover:border-primary/40 hover:bg-primary/[0.03] transition-all cursor-pointer group"
                            >
                                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0 group-hover:scale-110 transition-transform">
                                    <UserPlus className="h-6 w-6" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-black text-base">單堂報名</p>
                                    <p className="text-xs text-muted-foreground font-medium mt-0.5">扣除 1 堂卡，報名單一或多個堂次</p>
                                </div>
                                <ArrowRight className="h-5 w-5 text-muted-foreground/30 group-hover:translate-x-1 transition-transform" />
                            </div>

                            <div
                                onClick={() => availableQuota.length > 0 && setMode('makeup')}
                                className={cn(
                                    "flex items-center gap-5 p-5 rounded-2xl border-2 border-transparent transition-all cursor-pointer group",
                                    availableQuota.length > 0
                                        ? "bg-muted/5 hover:border-orange-500/40 hover:bg-orange-500/[0.03]"
                                        : "opacity-40 cursor-not-allowed grayscale bg-muted/10 border-dashed border-muted-foreground/20"
                                )}
                            >
                                <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0 group-hover:scale-110 transition-transform">
                                    <Calendar className="h-6 w-6" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-black text-base">補課申請</p>
                                    <p className="text-xs text-muted-foreground font-medium mt-0.5">
                                        {availableQuota.length > 0
                                            ? `使用剩餘額度 (${availableQuota.length} 堂可用)`
                                            : "目前無可用補課額度"}
                                    </p>
                                </div>
                                <ArrowRight className="h-5 w-5 text-muted-foreground/30 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </div>
                    )}

                    {/* Enroll Mode */}
                    {mode === 'enroll' && (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">選擇堂次 (可多選)</label>
                                <div className="grid gap-2.5 max-h-[220px] overflow-y-auto pr-2 scrollbar-hide">
                                    {sessions.map(s => (
                                        <div
                                            key={s.id}
                                            onClick={() => toggleTargetSession(s.id)}
                                            className={cn(
                                                "flex items-center justify-between p-5 rounded-2xl border-2 transition-all group/item",
                                                selectedTargetSessionIds.has(s.id)
                                                    ? "bg-primary/[0.03] border-primary font-black text-primary"
                                                    : "bg-muted/5 border-transparent hover:bg-muted/10 text-muted-foreground cursor-pointer"
                                            )}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={cn(
                                                    "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors shadow-sm",
                                                    selectedTargetSessionIds.has(s.id) ? "bg-primary border-primary" : "border-muted-foreground/30"
                                                )}>
                                                    {selectedTargetSessionIds.has(s.id) && <Check className="h-4 w-4 text-white stroke-[4]" />}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-base font-bold">第 {s.session_number} 堂 ({s.session_date})</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-5 rounded-2xl bg-primary/[0.03] border border-primary/10">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">扣除堂卡</span>
                                    <span className="text-2xl font-black text-primary">{selectedTargetSessionIds.size} <span className="text-xs opacity-60 ml-0.5">堂卡</span></span>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">目前餘額</span>
                                    <span className="text-sm font-black">{cardBalance} 堂</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Makeup Mode */}
                    {mode === 'makeup' && (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">欲補堂次 (目標)</label>
                                <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
                                    {sessions.map(s => (
                                        <div
                                            key={s.id}
                                            onClick={() => toggleTargetSession(s.id)}
                                            className={cn(
                                                "shrink-0 px-5 py-2.5 rounded-full border-2 text-sm font-black transition-all",
                                                selectedTargetSessionIds.has(s.id)
                                                    ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20"
                                                    : "bg-muted/10 border-transparent hover:border-primary/30 text-muted-foreground cursor-pointer"
                                            )}
                                        >
                                            L{s.session_number} ({s.session_date.slice(5)})
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">使用額度 (原始欠課)</label>
                                <div className="grid gap-2.5 max-h-[200px] overflow-y-auto pr-2 scrollbar-hide">
                                    {availableQuota.map(s => (
                                        <div
                                            key={s.sessionId}
                                            onClick={() => setSelectedOriginalSessionId(s.sessionId)}
                                            className={cn(
                                                "flex flex-col p-4 rounded-xl border-2 transition-all cursor-pointer",
                                                selectedOriginalSessionId === s.sessionId
                                                    ? "bg-orange-500/[0.03] border-orange-500"
                                                    : "bg-muted/5 border-transparent hover:bg-muted/10"
                                            )}
                                        >
                                            <div className="flex items-center justify-between w-full mb-1">
                                                <span className={cn("text-sm font-black", selectedOriginalSessionId === s.sessionId ? "text-orange-600" : "text-foreground")}>
                                                    {s.courseName}
                                                </span>
                                                {selectedOriginalSessionId === s.sessionId && <Check className="h-4 w-4 text-orange-600 stroke-[3]" />}
                                            </div>
                                            <span className="text-[11px] text-muted-foreground font-bold uppercase tracking-wider">
                                                第 {s.number} 堂 ({s.date})
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/10 text-orange-600 text-[11px] font-bold">
                                <Info className="h-3.5 w-3.5 shrink-0" />
                                <span>僅顯示本期可用的補課額度。若額度不足，請確認欠課程紀錄是否屬於本期。</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-8 pt-4 flex flex-col sm:flex-row gap-3 bg-muted/10 border-t border-muted-foreground/5 items-center">
                    {mode !== 'selection' && (
                        <Button variant="ghost" onClick={reset} className="font-black text-sm px-6 h-14 rounded-2xl w-full sm:w-auto">返回</Button>
                    )}

                    {mode === 'enroll' && (
                        <Button
                            onClick={handleBatchEnroll}
                            disabled={selectedTargetSessionIds.size === 0 || isPending}
                            className="bg-primary hover:bg-primary/95 text-primary-foreground flex-1 font-black rounded-2xl h-14 border-none shadow-xl shadow-primary/20 transition-all active:scale-[0.98] text-base"
                        >
                            {isPending && <Loader2 className="h-5 w-5 animate-spin mr-3" />}
                            確認報名 ({selectedTargetSessionIds.size})
                        </Button>
                    )}

                    {mode === 'makeup' && (
                        <Button
                            onClick={handleMakeupSubmit}
                            disabled={selectedTargetSessionIds.size === 0 || !selectedOriginalSessionId || isPending}
                            className="bg-orange-500 hover:bg-orange-600 text-white flex-1 font-black rounded-2xl h-14 border-none shadow-xl shadow-orange-500/20 transition-all active:scale-[0.98] text-base"
                        >
                            {isPending && <Loader2 className="h-5 w-5 animate-spin mr-3" />}
                            提交補課申請
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
