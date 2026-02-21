'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
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
} from '@/components/ui/alert-dialog';
import { enrollInCourse, cancelEnrollment } from '@/lib/supabase/actions';
import { cn } from '@/lib/utils';
import { Loader2, Check, UserPlus, UserMinus, Clock } from 'lucide-react';

interface EnrollmentButtonProps {
    courseId: string;
    courseStatus: string; // 'draft' | 'published' | 'closed'
    isEnrolled: boolean;
    isWaitlisted: boolean;
    waitlistPosition?: number;
    enrolledCount: number;
    capacity: number;
}

export function EnrollmentButton({
    courseId,
    courseStatus,
    isEnrolled,
    isWaitlisted,
    waitlistPosition,
    enrolledCount,
    capacity,
}: EnrollmentButtonProps) {
    const [isPending, startTransition] = useTransition();
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

    const isFull = enrolledCount >= capacity;
    const isOpen = courseStatus === 'published';

    const handleEnroll = () => {
        startTransition(async () => {
            try {
                const res = await enrollInCourse(courseId);
                setResult(res);
            } catch (e: any) {
                setResult({ success: false, message: e.message ?? '報名失敗' });
            }
        });
    };

    const handleCancel = () => {
        startTransition(async () => {
            try {
                const res = await cancelEnrollment(courseId);
                setResult(res);
            } catch (e: any) {
                setResult({ success: false, message: e.message ?? '取消失敗' });
            }
        });
    };

    // Already enrolled
    if (isEnrolled) {
        return (
            <div className="flex flex-col items-stretch gap-2">
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-500/10 text-green-600 border border-green-500/20">
                    <Check className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-bold">已報名</span>
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
        );
    }

    // On waitlist
    if (isWaitlisted) {
        return (
            <div className="flex flex-col items-stretch gap-2">
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500/10 text-orange-600 border border-orange-500/20">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-bold">候補中{waitlistPosition ? ` 第${waitlistPosition}位` : ''}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isPending} className="text-xs text-muted-foreground hover:bg-transparent hover:text-destructive font-medium justify-center transition-colors">
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserMinus className="h-3.5 w-3.5 mr-1" />}
                    取消候補
                </Button>
            </div>
        );
    }

    // Not open
    if (!isOpen) {
        return (
            <Button disabled className="w-full h-11 text-sm font-bold rounded-xl opacity-40 border border-muted-foreground/20 bg-transparent text-muted-foreground">
                {courseStatus === 'draft' ? '尚未開放報名' : '課程已結束'}
            </Button>
        );
    }

    // Can enroll (or join waitlist if full)
    return (
        <div className="flex flex-col gap-2">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        variant="ghost"
                        className={cn(
                            "w-full h-11 text-sm font-black rounded-xl border transition-all active:scale-[0.98]",
                            "bg-orange-500/10 border-orange-500/30 text-orange-500",
                            "hover:bg-orange-500/20 hover:border-orange-500/50 hover:text-orange-500",
                            "dark:hover:bg-orange-500/20",
                            isFull && "opacity-90"
                        )}
                        disabled={isPending}
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <UserPlus className="h-4 w-4 mr-2" />
                        )}
                        <span className="flex items-center justify-center">{isFull ? '加入候補' : '單堂報名'}</span>
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{isFull ? '確認加入候補？' : '確認報名？'}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {isFull
                                ? '目前名額已滿，您將被加入候補名單。有名額釋出時會自動遞補。'
                                : `報名後將佔用 1 個名額（目前 ${enrolledCount}/${capacity}）。`
                            }
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>返回</AlertDialogCancel>
                        <AlertDialogAction onClick={handleEnroll} disabled={isPending}>
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            確認{isFull ? '候補' : '報名'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <p className="text-xs text-center text-muted-foreground font-medium">
                {isFull ? `已額滿 ${enrolledCount}/${capacity}` : `剩餘 ${capacity - enrolledCount} 個名額`}
            </p>

            {result && !result.success && (
                <p className="text-xs text-center text-destructive font-medium">{result.message}</p>
            )}
        </div>
    );
}
