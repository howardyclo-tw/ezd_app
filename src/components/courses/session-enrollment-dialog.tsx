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
import { Checkbox } from "@/components/ui/checkbox";
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
    courseType?: string;
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
    courseType,
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
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-3xl border border-muted-foreground/10 shadow-2xl bg-background">
                <DialogHeader className="p-5 sm:p-8 pb-4 shrink-0">
                    <DialogTitle className="text-2xl font-black tracking-tight">
                        {mode === 'selection' ? '選擇加入方式' :
                            mode === 'enroll' ? '確認單堂報名' : '補課申請'}
                    </DialogTitle>
                    <DialogDescription className="text-base font-medium text-muted-foreground/80 mt-2">
                        {courseName} ({teacher})
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-4 space-y-5">
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

                            {(courseType === 'normal' || courseType === 'special') && (
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
                            )}
                        </div>
                    )}

                    {/* Enroll Mode */}
                    {mode === 'enroll' && (
                        <div className="flex flex-col gap-4 pb-4">
                            <div className="flex flex-col gap-2.5">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em] px-1">選擇堂次 (可多選)</label>
                                <div className="flex flex-col gap-3">
                                    {sessions.map(s => (
                                        <div
                                            key={s.id}
                                            onClick={() => toggleTargetSession(s.id)}
                                            className={cn(
                                                "w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer group text-left",
                                                selectedTargetSessionIds.has(s.id)
                                                    ? "bg-primary/[0.03] border-primary shadow-[0_0_20px_rgba(var(--primary),0.05)]"
                                                    : "bg-muted/5 border-transparent hover:border-primary/20 hover:bg-muted/10"
                                            )}
                                        >
                                            <div className="flex items-center gap-5 flex-1 min-w-0">
                                                <div className="flex items-center justify-center shrink-0">
                                                    <Checkbox
                                                        checked={selectedTargetSessionIds.has(s.id)}
                                                        onCheckedChange={() => toggleTargetSession(s.id)}
                                                        className="h-6 w-6 rounded-lg border-2 border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-black text-base truncate transition-colors pr-2">
                                                        第 {s.session_number} 堂
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[12px] font-bold text-muted-foreground/80">
                                                            {s.session_date}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Makeup Mode */}
                    {mode === 'makeup' && (
                        <div className="space-y-6 pb-4">
                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em] px-1">欲補堂次 (目標)</label>
                                <div className="flex flex-col gap-3">
                                    {sessions.map(s => (
                                        <div
                                            key={s.id}
                                            onClick={() => toggleTargetSession(s.id)}
                                            className={cn(
                                                "w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer group text-left",
                                                selectedTargetSessionIds.has(s.id)
                                                    ? "bg-orange-500/[0.03] border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.05)]"
                                                    : "bg-muted/5 border-transparent hover:border-orange-500/20 hover:bg-muted/10"
                                            )}
                                        >
                                            <div className="flex items-center gap-5 flex-1 min-w-0">
                                                <div className="flex items-center justify-center shrink-0">
                                                    <Checkbox
                                                        checked={selectedTargetSessionIds.has(s.id)}
                                                        onCheckedChange={() => toggleTargetSession(s.id)}
                                                        className="h-6 w-6 rounded-lg border-2 border-muted-foreground/30 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 data-[state=checked]:text-white"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-black text-base truncate transition-colors pr-2">
                                                        第 {s.session_number} 堂 <span className="text-muted-foreground text-sm font-bold ml-1">(目標)</span>
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[12px] font-bold text-muted-foreground/80">
                                                            {s.session_date}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em] px-1">使用額度 (原始欠課)</label>
                                <div className="flex flex-col gap-3">
                                    {availableQuota.map(s => (
                                        <div
                                            key={s.sessionId}
                                            onClick={() => setSelectedOriginalSessionId(s.sessionId)}
                                            className={cn(
                                                "w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer group text-left",
                                                selectedOriginalSessionId === s.sessionId
                                                    ? "bg-orange-500/[0.03] border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.05)]"
                                                    : "bg-muted/5 border-transparent hover:border-orange-500/20 hover:bg-muted/10"
                                            )}
                                        >
                                            <div className="flex items-center gap-5 flex-1 min-w-0">
                                                <div className="flex items-center justify-center shrink-0">
                                                    <Checkbox
                                                        checked={selectedOriginalSessionId === s.sessionId}
                                                        onCheckedChange={() => setSelectedOriginalSessionId(s.sessionId)}
                                                        className="h-6 w-6 rounded-lg border-2 border-muted-foreground/30 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 data-[state=checked]:text-white"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-black text-base truncate transition-colors pr-2">
                                                        {s.courseName}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <Badge variant="secondary" className="h-5 px-2 text-[10px] font-black uppercase tracking-widest bg-muted/50 border-none">
                                                            第 {s.number} 堂
                                                        </Badge>
                                                        <span className="text-[12px] font-bold text-muted-foreground/80">
                                                            {s.date}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Section depending on mode */}
                {mode === 'selection' && (
                    <div className="p-6 pt-2 flex flex-col sm:flex-row gap-3 bg-muted/10 border-t border-muted-foreground/5 items-center justify-end shrink-0">
                        <Button variant="ghost" onClick={() => setIsOpen(false)} className="font-black text-sm px-6 h-14 rounded-2xl w-full sm:w-auto">關閉</Button>
                    </div>
                )}

                {mode === 'enroll' && (
                    <div className="p-5 sm:p-8 pt-4 flex flex-col gap-6 bg-muted/10 border-t border-muted-foreground/5 shrink-0">
                        <div className="flex items-center justify-between w-full px-1">
                            <div className="flex flex-col gap-1">
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">目前餘額</span>
                                <span className="text-sm font-black flex items-center gap-1.5">
                                    <span className="bg-muted px-2 py-0.5 rounded-md text-foreground">{cardBalance}</span>
                                    <span className="text-[11px] opacity-40">堂卡</span>
                                </span>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">預計扣除</span>
                                <span className={cn(
                                    "text-2xl font-black leading-none",
                                    cardBalance < selectedTargetSessionIds.size ? "text-destructive" : "text-primary"
                                )}>
                                    {selectedTargetSessionIds.size} <span className="text-xs opacity-40 font-bold ml-0.5">堂卡</span>
                                </span>
                            </div>
                        </div>

                        {cardBalance < selectedTargetSessionIds.size && (
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 text-destructive text-sm font-bold animate-in fade-in slide-in-from-top-1">
                                <Info className="h-4 w-4 shrink-0" />
                                <span>餘額不足，請先購買堂卡。</span>
                            </div>
                        )}

                        <div className="flex items-start gap-3 p-3 px-5 bg-amber-500/5 text-amber-500/90 rounded-2xl border border-amber-500/10">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
                            <p className="text-[11px] font-bold leading-relaxed">
                                單堂報名不具備請假、轉讓或更換日期之權利。
                            </p>
                        </div>

                        <div className="flex gap-3 mt-1 w-full">
                            <Button variant="ghost" onClick={reset} className="font-black text-sm px-6 h-14 rounded-2xl shrink-0">返回</Button>
                            <Button
                                onClick={handleBatchEnroll}
                                disabled={selectedTargetSessionIds.size === 0 || isPending || cardBalance < selectedTargetSessionIds.size}
                                className="flex-1 h-14 font-black text-base bg-primary hover:bg-primary/95 text-primary-foreground rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-[0.98] border-none"
                            >
                                {isPending ? (
                                    <Loader2 className="h-5 w-5 animate-spin mr-3" />
                                ) : (
                                    <Check className="h-5 w-5 mr-3" />
                                )}
                                確認報名 ({selectedTargetSessionIds.size})
                            </Button>
                        </div>
                    </div>
                )}

                {mode === 'makeup' && (
                    <div className="p-5 sm:p-8 pt-4 flex flex-col gap-6 bg-muted/10 border-t border-muted-foreground/5 shrink-0">
                        <div className="flex items-center justify-between w-full px-1">
                            <div className="flex flex-col gap-1">
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">可用額度</span>
                                <span className="text-sm font-black flex items-center gap-1.5">
                                    <span className="bg-muted px-2 py-0.5 rounded-md text-foreground">{availableQuota.length}</span>
                                    <span className="text-[11px] opacity-40">堂 (本期)</span>
                                </span>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">預計扣抵</span>
                                <span className={cn(
                                    "text-2xl font-black leading-none",
                                    (!selectedOriginalSessionId || selectedTargetSessionIds.size === 0) ? "text-muted-foreground/50" : "text-orange-500"
                                )}>
                                    {selectedTargetSessionIds.size} <span className="text-xs opacity-40 font-bold ml-0.5">堂</span>
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 px-5 bg-orange-500/10 text-orange-600 rounded-2xl border border-orange-500/10">
                            <Info className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
                            <p className="text-[11px] font-bold leading-relaxed">
                                僅顯示本期可用的補課額度。若額度不足，請確認欠課程紀錄是否屬於本期。
                            </p>
                        </div>

                        <div className="flex gap-3 mt-1 w-full">
                            <Button variant="ghost" onClick={reset} className="font-black text-sm px-6 h-14 rounded-2xl shrink-0">返回</Button>
                            <Button
                                onClick={handleMakeupSubmit}
                                disabled={selectedTargetSessionIds.size === 0 || !selectedOriginalSessionId || isPending}
                                className="flex-1 h-14 font-black text-base bg-orange-500 hover:bg-orange-600 text-white rounded-2xl shadow-xl shadow-orange-500/20 transition-all active:scale-[0.98] border-none"
                            >
                                {isPending ? (
                                    <Loader2 className="h-5 w-5 animate-spin mr-3" />
                                ) : (
                                    <Check className="h-5 w-5 mr-3" />
                                )}
                                提交申請
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
