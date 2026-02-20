'use client';

import { useState, useTransition } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Check, X, Clock, User, Calendar, Loader2, AlertCircle } from "lucide-react";
import { reviewLeaveRequest, reviewMakeupRequest, reviewTransferRequest } from '@/lib/supabase/actions';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export function ApprovalsList({ initialApprovals, isAdmin, currentUserId }: { initialApprovals: any[], isAdmin: boolean, currentUserId: string }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [approvals, setApprovals] = useState(initialApprovals);

    const handleReview = async (id: string, type: 'leave' | 'makeup' | 'transfer', decision: 'approved' | 'rejected') => {
        startTransition(async () => {
            try {
                let res;
                if (type === 'leave') res = await reviewLeaveRequest(id, decision);
                else if (type === 'makeup') res = await reviewMakeupRequest(id, decision);
                else res = await reviewTransferRequest(id, decision);

                if (res.success) {
                    setApprovals(prev => prev.filter(a => a.id !== id));
                    router.refresh();
                } else {
                    alert(res.message);
                }
            } catch (err) {
                alert(err instanceof Error ? err.message : '審核失敗');
            }
        });
    };

    if (approvals.length === 0) {
        return (
            <Card className="border-dashed border-muted/50 bg-muted/5">
                <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                        <Check className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground/80">目前沒有待處理申請</h3>
                    <p className="text-sm text-muted-foreground mt-1 px-4">
                        太棒了！所有的申請都已處理完畢。
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {approvals.map((req) => (
                <Card key={req.id} className="border-border/40 shadow-sm overflow-hidden bg-card/50 backdrop-blur-sm">
                    <CardContent className="p-0">
                        <div className="flex flex-col sm:flex-row items-stretch">
                            {/* Type Indicator */}
                            <div className={cn(
                                "w-2 sm:w-3 shrink-0",
                                req.type === 'leave' ? "bg-red-500/60" : req.type === 'makeup' ? "bg-blue-500/60" : "bg-purple-500/60"
                            )} />

                            <div className="flex-1 p-5 space-y-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider">
                                                {req.type === 'leave' ? '請假' : req.type === 'makeup' ? '補課' : '轉讓'}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground font-medium">
                                                {format(parseISO(req.created_at), "yyyy/MM/dd HH:mm")}
                                            </span>
                                        </div>
                                        <h3 className="text-lg font-bold flex items-center gap-2">
                                            {req.profiles?.name || req.from_profile?.name || '未知使用者'}
                                        </h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-9 px-3 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                                            disabled={isPending}
                                            onClick={() => handleReview(req.id, req.type, 'rejected')}
                                        >
                                            <X className="h-4 w-4 mr-1" /> 拒絕
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90"
                                            disabled={isPending}
                                            onClick={() => handleReview(req.id, req.type, 'approved')}
                                        >
                                            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                                            核准
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-muted/20">
                                    <div className="space-y-1.5">
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">詳情</p>
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <Calendar className="h-3.5 w-3.5 opacity-50" />
                                            <span>
                                                {req.type === 'leave' && `${req.courses?.name} 第 ${req.course_sessions?.session_number} 堂 (${req.course_sessions?.session_date})`}
                                                {req.type === 'makeup' && `從 ${req.original_courses?.name} 補至 ${req.target_courses?.name} (${req.target_sessions?.session_date})`}
                                                {req.type === 'transfer' && `${req.courses?.name} 轉給 ${req.to_profile?.name || req.to_user_name || '現場學員'}`}
                                            </span>
                                        </div>
                                    </div>
                                    {req.reason && (
                                        <div className="space-y-1.5">
                                            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">原因</p>
                                            <p className="text-sm text-foreground/80 leading-relaxed italic">
                                                「{req.reason}」
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

