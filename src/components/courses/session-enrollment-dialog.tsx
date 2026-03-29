'use client';

import { useState, useTransition, useEffect } from 'react';
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
    Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { batchEnrollInSessions as _batchEnrollInSessions, batchSubmitMakeupRequests as _batchSubmitMakeupRequests } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
const batchEnrollInSessions = safe(_batchEnrollInSessions);
const batchSubmitMakeupRequests = safe(_batchSubmitMakeupRequests);
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
    makeupQuota?: { total: number, used: number, remaining: number, manualQuota?: number };
    isFull: boolean;
    enrolledCount: number;
    capacity: number;
    courseType?: string;
    cardsPerSession?: number;
    sessionOccupancy?: Record<string, number>;
    excludeSessionIds?: string[];
}

export function SessionEnrollmentDialog({
    courseId,
    courseName,
    teacher,
    groupId,
    cardBalance,
    sessions,
    missedSessions,
    makeupQuota = { total: 0, used: 0, remaining: 0 },
    isFull,
    enrolledCount,
    capacity,
    courseType,
    cardsPerSession = 1,
    sessionOccupancy = {},
    excludeSessionIds = [],
}: SessionEnrollmentDialogProps) {
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    const [mounted, setMounted] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => { setMounted(true); }, []);
    const [mode, setMode] = useState<'selection' | 'enroll' | 'makeup'>('selection');
    const [selectedTargetSessionIds, setSelectedTargetSessionIds] = useState<Set<string>>(new Set());
    const [selectedOriginalSessionId, setSelectedOriginalSessionId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    // Filter missed sessions to only include those from the SAME group (period)
    // AND hide those where the course quota is already exhausted to reduce confusion.
    const availableQuota = missedSessions.filter(ms => ms.groupId === groupId && !(ms as any).isQuotaFull);
    
    // Absence-based quota is capped by actual missed session count;
    // Manual quota (幹部贈予) adds on top without needing absence sources.
    const manual = makeupQuota.manualQuota ?? 0;
    const absenceBased = availableQuota.length > 0
        ? Math.min(availableQuota.length, makeupQuota.remaining - manual)
        : 0;
    const trueAvailableCount = absenceBased + manual;

    // canMakeup is true if there's remaining quota (with or without absence sources)
    const canMakeup = makeupQuota.remaining > 0;
    const hasSourceSessions = availableQuota.length > 0;

    const toggleTargetSession = (id: string) => {
        const next = new Set(selectedTargetSessionIds);
        if (next.has(id)) next.delete(id);
        else {
            // In makeup mode, don't allow selecting more than available quota
            if (mode === 'makeup' && next.size >= trueAvailableCount) {
                toast.error(`超過可用補課額度 (${trueAvailableCount} 堂)`);
                return;
            }
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
        const targetIds = Array.from(selectedTargetSessionIds);
        if (targetIds.length === 0) return;

        startTransition(async () => {
            try {
                const res = await batchSubmitMakeupRequests(courseId, targetIds);
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

    if (!mounted) {
        return (
            <Button
                variant="ghost"
                className={cn(
                    "w-full h-11 text-sm font-black rounded-xl border transition-all",
                    "bg-orange-500/10 border-orange-500/30 text-orange-500",
                    isFull && "opacity-90"
                )}
                disabled
            >
                <UserPlus className="h-4 w-4 mr-2" />
                單堂報名 / 補課
            </Button>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { reset(); setIsOpen(open); }}>
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
                    <span>
                        單堂報名 {(courseType === 'normal' || courseType === 'special') && '/ 補課'}
                    </span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-3xl border border-muted-foreground/10 shadow-2xl bg-background">
                <DialogHeader className="p-5 sm:p-8 pb-4 shrink-0">
                    <DialogTitle className="text-2xl font-black tracking-tight">
                        {mode === 'selection' ? '選擇加入方式' :
                            mode === 'enroll' ? '單堂報名' : '補課申請'}
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
                                className="flex items-center gap-5 p-5 rounded-2xl border-2 border-transparent bg-muted/5 hover:border-orange-500/40 hover:bg-orange-500/[0.03] transition-all cursor-pointer group"
                            >
                                <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500 shrink-0 group-hover:scale-110 transition-transform">
                                    <UserPlus className="h-6 w-6" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-black text-base">單堂報名</p>
                                    <p className="text-xs text-muted-foreground font-medium mt-0.5">每堂扣除 {cardsPerSession} 堂卡{cardsPerSession === 0 ? '（免費）' : '，報名單一或多個堂次'}</p>
                                </div>
                                <ArrowRight className="h-5 w-5 text-muted-foreground/30 group-hover:translate-x-1 transition-transform" />
                            </div>

                            {(courseType === 'normal' || courseType === 'special') && (
                                <div
                                    onClick={() => canMakeup && setMode('makeup')}
                                    className={cn(
                                        "flex items-center gap-5 p-5 rounded-2xl border-2 border-transparent transition-all cursor-pointer group",
                                        canMakeup
                                            ? "bg-muted/5 hover:border-blue-500/40 hover:bg-blue-500/[0.03]"
                                            : "opacity-40 cursor-not-allowed grayscale bg-muted/10 border-dashed border-muted-foreground/20"
                                    )}
                                >
                                    <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0 group-hover:scale-110 transition-transform">
                                        <Calendar className="h-6 w-6" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black text-base">補課申請</p>
                                        <p className="text-xs text-muted-foreground font-medium mt-0.5">
                                            {canMakeup
                                                ? `使用剩餘額度 (${trueAvailableCount} 堂可用)`
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
                                    {sessions.map(s => { const isPast = s.session_date < todayStr; const isExcluded = excludeSessionIds.includes(s.id); const isFull = (sessionOccupancy[s.id] ?? 0) >= capacity; const isDisabled = isPast || isExcluded || (isFull && !selectedTargetSessionIds.has(s.id)); return (
                                        <div
                                            key={s.id}
                                            className={cn(
                                                "w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all text-left",
                                                isDisabled
                                                    ? "opacity-50 grayscale cursor-not-allowed bg-muted/10 border-muted"
                                                    : selectedTargetSessionIds.has(s.id)
                                                        ? "bg-orange-500/[0.03] border-orange-500 shadow-[0_0_20px_rgba(var(--orange-500),0.05)] cursor-pointer"
                                                        : "bg-muted/5 border-transparent hover:border-orange-500/20 hover:bg-muted/10 cursor-pointer"
                                            )}
                                            onClick={() => !isDisabled && toggleTargetSession(s.id)}
                                        >
                                            <div className="flex items-center gap-5 flex-1 min-w-0 h-full">
                                                {!isPast && (
                                                <div className="flex items-center justify-center shrink-0">
                                                    <Checkbox
                                                        checked={selectedTargetSessionIds.has(s.id) || isExcluded}
                                                        onCheckedChange={() => !isDisabled && toggleTargetSession(s.id)}
                                                        disabled={isDisabled}
                                                        className={cn(
                                                            "h-6 w-6 rounded-lg border-2 transition-all [&_svg]:!size-4",
                                                            "border-muted-foreground/30",
                                                            "data-[state=checked]:!bg-orange-500 data-[state=checked]:!border-orange-500 data-[state=checked]:!text-white",
                                                            "disabled:opacity-100 disabled:!bg-muted/30 disabled:!border-muted-foreground/30 disabled:!text-muted-foreground"
                                                        )}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </div>
                                                )}
                                                <div className="min-w-0 flex-1 flex flex-col justify-center">
                                                    <p className="font-black text-base truncate transition-colors pr-2 leading-none">
                                                        第 {s.session_number} 堂
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1.5">
                                                        <span className="text-[12px] font-bold text-muted-foreground/80 leading-none">
                                                            {s.session_date}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className={cn(
                                                    "text-[10px] h-5 px-2 font-black rounded-md flex items-center gap-1 shrink-0 self-center",
                                                    isPast ? "bg-muted text-muted-foreground"
                                                        : isExcluded ? "bg-muted text-muted-foreground"
                                                        : selectedTargetSessionIds.has(s.id) ? "bg-orange-500/10 text-orange-500"
                                                        : isFull ? "bg-red-500/10 text-red-500"
                                                        : "bg-muted/10 text-muted-foreground"
                                                )}>
                                                    {isPast ? "已過期" : isExcluded ? <><Users className="h-3 w-3" />已在名單</> : <><Users className="h-3 w-3" />{(sessionOccupancy[s.id] ?? 0)}/{capacity}</>}
                                                </div>
                                            </div>
                                        </div>
                                    ); })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Makeup Mode */}
                    {mode === 'makeup' && (
                        <div className="space-y-6 pb-4">
                            <div className="space-y-3">
                                <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em] px-1">欲補堂次</label>
                                <div className="flex flex-col gap-3">
                                    {sessions.map(s => { const isPast = s.session_date < todayStr; const isExcluded = excludeSessionIds.includes(s.id); const isFull = (sessionOccupancy[s.id] ?? 0) >= capacity; const isDisabled = isPast || isExcluded || (isFull && !selectedTargetSessionIds.has(s.id)); return (
                                        <div
                                            key={s.id}
                                            className={cn(
                                                "w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all text-left",
                                                isDisabled
                                                    ? "opacity-50 grayscale cursor-not-allowed bg-muted/10 border-muted"
                                                    : selectedTargetSessionIds.has(s.id)
                                                        ? "bg-blue-500/[0.03] border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.05)] cursor-pointer"
                                                        : "bg-muted/5 border-transparent hover:border-blue-500/20 hover:bg-muted/10 cursor-pointer"
                                            )}
                                            onClick={() => !isDisabled && toggleTargetSession(s.id)}
                                        >
                                            <div className="flex items-center gap-5 flex-1 min-w-0 h-full">
                                                {!isPast && (
                                                <div className="flex items-center justify-center shrink-0">
                                                    <Checkbox
                                                        checked={selectedTargetSessionIds.has(s.id) || isExcluded}
                                                        onCheckedChange={() => !isDisabled && toggleTargetSession(s.id)}
                                                        disabled={isDisabled}
                                                        className={cn(
                                                            "h-6 w-6 rounded-lg border-2 transition-all [&_svg]:!size-4",
                                                            "border-muted-foreground/30",
                                                            "data-[state=checked]:!bg-blue-500 data-[state=checked]:!border-blue-500 data-[state=checked]:!text-white",
                                                            "disabled:opacity-100 disabled:!bg-muted/30 disabled:!border-muted-foreground/30 disabled:!text-muted-foreground"
                                                        )}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </div>
                                                )}
                                                <div className="min-w-0 flex-1 flex flex-col justify-center">
                                                    <p className="font-black text-base truncate transition-colors pr-2 leading-none">
                                                        第 {s.session_number} 堂
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1.5">
                                                        <span className="text-[12px] font-bold text-muted-foreground/80 leading-none">
                                                            {s.session_date}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className={cn(
                                                    "text-[10px] h-5 px-2 font-black rounded-md flex items-center gap-1 shrink-0 self-center",
                                                    isPast ? "bg-muted text-muted-foreground"
                                                        : isExcluded ? "bg-muted text-muted-foreground"
                                                        : selectedTargetSessionIds.has(s.id) ? "bg-blue-500/10 text-blue-500"
                                                        : isFull ? "bg-red-500/10 text-red-500"
                                                        : "bg-muted/10 text-muted-foreground"
                                                )}>
                                                    {isPast ? "已過期" : isExcluded ? <><Users className="h-3 w-3" />已在名單</> : <><Users className="h-3 w-3" />{(sessionOccupancy[s.id] ?? 0)}/{capacity}</>}
                                                </div>
                                            </div>
                                        </div>
                                    ); })}
                                </div>
                            </div>

                            {/* Missed session list removed per user request to simplify UI and use auto-selection */}
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
                                    cardBalance < selectedTargetSessionIds.size * cardsPerSession ? "text-destructive" : "text-orange-500"
                                )}>
                                    {selectedTargetSessionIds.size * cardsPerSession} <span className="text-xs opacity-40 font-bold ml-0.5">堂卡</span>
                                </span>
                            </div>
                        </div>

                        {cardBalance < selectedTargetSessionIds.size * cardsPerSession && (
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 text-destructive text-sm font-bold animate-in fade-in slide-in-from-top-1">
                                <Info className="h-4 w-4 shrink-0" />
                                <span>餘額不足，請先購買堂卡。</span>
                            </div>
                        )}

                        <p className="text-[10px] text-muted-foreground/40 text-center font-medium">
                            系統會優先使用最快到期的堂卡，已過期的堂卡無法用於該日期後的堂次
                        </p>

                        <div className="flex items-start gap-3 p-3 px-5 bg-orange-500/5 text-orange-500/90 rounded-2xl border border-orange-500/10">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
                            <p className="text-[11px] font-bold leading-relaxed">
                                單堂報名不具備請假、轉讓或更換日期之權利。
                            </p>
                        </div>

                        <div className="flex gap-3 mt-1 w-full">
                            <Button variant="ghost" onClick={reset} className="font-black text-sm px-6 h-14 rounded-2xl shrink-0">返回</Button>
                            <Button
                                onClick={handleBatchEnroll}
                                disabled={selectedTargetSessionIds.size === 0 || isPending || cardBalance < selectedTargetSessionIds.size * cardsPerSession}
                                className="flex-1 h-14 font-black text-base bg-orange-500 hover:bg-orange-600 text-white rounded-2xl shadow-xl shadow-orange-500/20 transition-all active:scale-[0.98] border-none"
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
                                    <span className="bg-muted px-2 py-0.5 rounded-md text-foreground">
                                        {trueAvailableCount}
                                    </span>
                                    <span className="text-[11px] opacity-40">堂 (本期)</span>
                                </span>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">預計扣抵</span>
                                <span className={cn(
                                    "text-2xl font-black leading-none",
                                    selectedTargetSessionIds.size === 0 ? "text-muted-foreground/50" : "text-blue-500"
                                )}>
                                    {selectedTargetSessionIds.size} <span className="text-xs opacity-40 font-bold ml-0.5">堂</span>
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 px-5 bg-blue-500/10 text-blue-600 rounded-2xl border border-blue-500/10">
                            <Info className="h-4 w-4 shrink-0 mt-0.5 opacity-80" />
                            <p className="text-[11px] font-bold leading-relaxed">
                                僅顯示本期可用的補課額度。若額度不足，請確認欠課程紀錄是否屬於本期。
                            </p>
                        </div>

                        <div className="flex gap-3 mt-1 w-full">
                            <Button variant="ghost" onClick={reset} className="font-black text-sm px-6 h-14 rounded-2xl shrink-0">返回</Button>
                            <Button
                                onClick={handleMakeupSubmit}
                                disabled={selectedTargetSessionIds.size === 0 || isPending}
                                className="flex-1 h-14 font-black text-base bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98] border-none"
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
            </DialogContent>
        </Dialog>
    );
}
