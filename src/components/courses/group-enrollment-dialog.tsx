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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, UserPlus, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { batchEnrollInCourses } from '@/lib/supabase/actions';
import { toast } from 'sonner';

interface CourseOption {
    id: string;
    name: string;
    teacher: string;
    sessionsCount: number;
    cardsPerSession: number;
    isEnrolled: boolean;
    isFull: boolean;
}

interface GroupEnrollmentDialogProps {
    groupTitle: string;
    courses: CourseOption[];
    cardBalance: number;
}

export function GroupEnrollmentDialog({
    groupTitle,
    courses,
    cardBalance,
}: GroupEnrollmentDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const selectableCourses = courses.filter(c => !c.isEnrolled);

    const toggleCourse = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const totalCost = Array.from(selectedIds).reduce((sum, id) => {
        const course = courses.find(c => c.id === id);
        if (!course) return sum;
        return sum + (course.cardsPerSession * course.sessionsCount);
    }, 0);

    const isOverBalance = totalCost > cardBalance;

    const handleEnroll = () => {
        if (selectedIds.size === 0) return;

        startTransition(async () => {
            try {
                const res = await batchEnrollInCourses(Array.from(selectedIds));
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

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    size="lg"
                    className="w-full sm:w-auto font-bold bg-primary hover:bg-primary/90 text-primary-foreground border-none transition-all active:scale-95 rounded-xl px-6 h-11 flex items-center gap-2.5 shadow-lg shadow-primary/20"
                >
                    <UserPlus className="h-5 w-5 stroke-[2.5]" />
                    <span>整期報名</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-3xl border border-muted-foreground/10 shadow-2xl bg-background">
                <DialogHeader className="p-8 pb-4">
                    <DialogTitle className="text-2xl font-black tracking-tight">{groupTitle}</DialogTitle>
                    <DialogDescription className="text-base font-medium text-muted-foreground/80 mt-2">
                        請選擇欲報名的課程，系統將自動扣除應繳堂卡。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-8 py-4 space-y-4">
                    {selectableCourses.length === 0 ? (
                        <div className="text-center py-20 text-muted-foreground italic text-sm bg-muted/5 rounded-2xl border border-dashed">
                            目前無可報名的課程
                        </div>
                    ) : (
                        selectableCourses.map((course) => (
                            <div
                                key={course.id}
                                onClick={() => !course.isFull && toggleCourse(course.id)}
                                className={cn(
                                    "w-full flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer group text-left",
                                    selectedIds.has(course.id)
                                        ? "bg-primary/[0.03] border-primary shadow-[0_0_20px_rgba(var(--primary),0.05)]"
                                        : "bg-muted/5 border-transparent hover:border-primary/20 hover:bg-muted/10",
                                    course.isFull && "opacity-40 cursor-not-allowed grayscale bg-muted/20"
                                )}
                            >
                                <div className="flex items-center gap-5 flex-1 min-w-0">
                                    <div className="flex items-center justify-center shrink-0">
                                        <Checkbox
                                            checked={selectedIds.has(course.id)}
                                            onCheckedChange={() => !course.isFull && toggleCourse(course.id)}
                                            disabled={course.isFull}
                                            className="h-6 w-6 rounded-lg border-2 border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-black text-base truncate group-hover:text-primary transition-colors pr-2">
                                            {course.teacher} {course.name}
                                        </p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <Badge variant="secondary" className="h-5 px-2 text-[10px] font-black uppercase tracking-widest bg-muted/50 border-none">
                                                {course.sessionsCount} 堂
                                            </Badge>
                                            <span className="text-[11px] font-bold text-muted-foreground/60">
                                                共 {course.sessionsCount * course.cardsPerSession} 堂卡
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                {course.isFull && (
                                    <Badge variant="secondary" className="bg-muted text-muted-foreground font-black text-[10px] rounded-md px-2 py-0.5">
                                        額滿
                                    </Badge>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="p-8 pt-4 flex flex-col gap-6 bg-muted/10 border-t border-muted-foreground/5">
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
                                isOverBalance ? "text-destructive" : "text-primary"
                            )}>
                                {totalCost} <span className="text-xs opacity-40 font-bold ml-0.5">堂卡</span>
                            </span>
                        </div>
                    </div>

                    {isOverBalance && (
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/10 text-destructive text-sm font-bold animate-in fade-in slide-in-from-top-1">
                            <Info className="h-4 w-4 shrink-0" />
                            <span>餘額不足，請先購買堂卡。</span>
                        </div>
                    )}

                    <Button
                        onClick={handleEnroll}
                        disabled={selectedIds.size === 0 || isPending || isOverBalance}
                        className="w-full h-14 font-black text-base bg-primary hover:bg-primary/95 text-primary-foreground rounded-2xl shadow-xl shadow-primary/20 transition-all active:scale-[0.98] border-none"
                    >
                        {isPending ? (
                            <Loader2 className="h-5 w-5 animate-spin mr-3" />
                        ) : (
                            <Check className="h-5 w-5 mr-3" />
                        )}
                        確認報名 ({selectedIds.size})
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

const Check = ({ className }: { className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <polyline points="20 6 9 17 4 12" />
    </svg>
);
