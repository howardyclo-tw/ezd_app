'use client';

import { useState, useTransition } from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Check, Calendar, Loader2, Star, ClipboardList, X, CreditCard, User, Clock, Info, Ban } from "lucide-react";
import { confirmCardOrder as _confirmCardOrder, rejectCardOrder as _rejectCardOrder, reviewLeaveRequest as _reviewLeaveRequest, reviewMakeupRequest as _reviewMakeupRequest, reviewTransferRequest as _reviewTransferRequest } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
const confirmCardOrder = safe(_confirmCardOrder);
const rejectCardOrder = safe(_rejectCardOrder);
const reviewLeaveRequest = safe(_reviewLeaveRequest);
const reviewMakeupRequest = safe(_reviewMakeupRequest);
const reviewTransferRequest = safe(_reviewTransferRequest);
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface ApprovalsTabsClientProps {
    cardOrders: any[];
    leaves: any[];
    makeups: any[];
    transfers: any[];
    currentUserId: string;
}

export function ApprovalsTabsClient({ cardOrders, leaves, makeups, transfers, currentUserId }: ApprovalsTabsClientProps) {
    const router = useRouter();
    const [tab, setTab] = useState('card_orders');
    const [isPending, startTransition] = useTransition();

    const currentList = tab === 'card_orders'
        ? cardOrders
        : tab === 'leaves'
            ? leaves
            : tab === 'makeups'
                ? makeups
                : transfers;

    const handleConfirmCardOrder = async (id: string) => {
        startTransition(async () => {
            try {
                const res = await confirmCardOrder(id);
                if (res.success) {
                    router.refresh();
                } else {
                    alert(res.message);
                }
            } catch (err) {
                alert(err instanceof Error ? err.message : '審核失敗');
            }
        });
    };

    const handleRejectCardOrder = async (id: string, currentStatus: string) => {
        if (currentStatus === 'confirmed' && !confirm('此訂單已確認核發堂卡，駁回將會扣除使用者的堂卡餘額，確定要繼續嗎？')) {
            return;
        } else if (!confirm('確定要將此訂單標記為駁回嗎？')) {
            return;
        }

        startTransition(async () => {
            try {
                const res = await rejectCardOrder(id);
                if (res.success) {
                    router.refresh();
                } else {
                    alert(res.message);
                }
            } catch (err) {
                alert(err instanceof Error ? err.message : '駁回失敗');
            }
        });
    };

    const handleToggleStatus = async (id: string, requestType: 'leaves' | 'makeups' | 'transfers', currentStatus: 'pending' | 'approved' | 'rejected') => {
        const newStatus = currentStatus === 'rejected' ? 'approved' : 'rejected';
        const confirmMessage = newStatus === 'rejected'
            ? '確定要駁回此申請嗎？這將會從點名單中移除該筆紀錄。'
            : '確定要重新核准此申請嗎？這將會重新更新點名單。';

        if (!confirm(confirmMessage)) return;

        startTransition(async () => {
            try {
                let res;
                if (requestType === 'leaves') {
                    res = await reviewLeaveRequest(id, newStatus);
                } else if (requestType === 'makeups') {
                    res = await reviewMakeupRequest(id, newStatus);
                } else {
                    res = await reviewTransferRequest(id, newStatus);
                }

                if (res.success) {
                    router.refresh();
                } else {
                    alert(res.message);
                }
            } catch (err) {
                alert(err instanceof Error ? err.message : '操作失敗');
            }
        });
    };

    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    const tabHints: Record<string, { title: string; hint: string }> = {
        card_orders: {
            title: '堂卡審核說明',
            hint: '核准：核發堂卡並更新餘額\n駁回：取消訂單，已核發的堂卡會扣回餘額（不影響已報名的課程紀錄）\n駁回後可重新核准，堂卡會重新核發',
        },
        leaves: {
            title: '請假審核說明',
            hint: '系統自動核准，通常不需手動操作\n駁回：撤銷請假，學員在點名單上恢復為原本的出席身份（補課學員的請假被駁回不歸還補課額度）\n駁回後可重新核准',
        },
        makeups: {
            title: '補課審核說明',
            hint: '系統自動核准，通常不需手動操作\n駁回：清除目標堂次出席紀錄，歸還 1 點補課額度\n若駁回後重新審核：恢復出席紀錄，幹部贈予的補課會再扣 1 點額度',
        },
        transfers: {
            title: '轉讓審核說明',
            hint: '系統自動核准，通常不需手動操作\n駁回：清除轉出/轉入出席紀錄，雙方恢復原狀\n駁回後可重新核准',
        },
    };

    const emptyMessages: Record<string, { title: string; desc: string }> = {
        card_orders: { title: '沒有待對帳的堂卡訂單', desc: '太棒了！所有的訂單都已處理完畢。' },
        leaves: { title: '尚無近期請假紀錄', desc: '最近 30 天內沒有請假紀錄。' },
        makeups: { title: '尚無近期補課紀錄', desc: '最近 30 天內沒有補課紀錄。' },
        transfers: { title: '尚無近期轉讓紀錄', desc: '最近 30 天內沒有轉讓紀錄。' },
    };

    return (
        <>
            {/* Filter Tabs */}
            <div className="flex justify-center mb-10 px-4 sm:px-0">
                <Tabs defaultValue="card_orders" className="w-full sm:w-auto" onValueChange={setTab}>
                    <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 w-full grid grid-cols-4 sm:flex sm:grid-cols-none sm:w-auto">
                        <TabsTrigger value="card_orders" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            堂卡訂單
                        </TabsTrigger>
                        <TabsTrigger value="leaves" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            請假紀錄
                        </TabsTrigger>
                        <TabsTrigger value="makeups" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            補課紀錄
                        </TabsTrigger>
                        <TabsTrigger value="transfers" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm">
                            轉讓紀錄
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* Tab Hint */}
            <div className="bg-blue-500/10 border border-blue-500/20 backdrop-blur-md rounded-2xl p-4 flex items-start gap-4 shadow-xl">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0 border border-blue-500/30">
                    <Info className="h-5 w-5 text-blue-400" />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-black text-blue-100 uppercase tracking-widest mb-1.5 opacity-80">{tabHints[tab].title}</p>
                    <div className="text-sm font-bold text-white/70 leading-relaxed whitespace-pre-line">
                        {tabHints[tab].hint}
                    </div>
                </div>
            </div>

            {/* Content */}
            {currentList.length === 0 ? (
                <Card className="border-dashed border-muted/50 bg-muted/5 mt-6">
                    <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                            {tab === 'card_orders' ? (
                                <CreditCard className="h-8 w-8 text-muted-foreground/40" />
                            ) : (
                                <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
                            )}
                        </div>
                        <h3 className="text-lg font-bold text-foreground/80">{emptyMessages[tab]?.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1 px-4 max-w-xs mx-auto">
                            {emptyMessages[tab]?.desc}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4 mt-6">
                    {currentList.map((req) => {
                        const isCardOrder = tab === 'card_orders';
                        // Determine session date for expiry check
                        const sessionDate = tab === 'makeups'
                            ? req.target_sessions?.session_date
                            : req.course_sessions?.session_date;
                        const isPast = !isCardOrder && sessionDate && sessionDate < todayStr;

                        return (
                            <Card key={req.id} className="relative overflow-hidden border-muted/50 bg-card/40 backdrop-blur-md shadow-sm transition-all hover:border-primary/30 hover:shadow-md">
                                <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
                                    {/* Left Side: Information */}
                                    <div className="flex-1 space-y-3">
                                        {/* Row 1: Badges & Timestamp */}
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            <Badge variant="outline" className={cn(
                                                "text-[10px] font-bold uppercase tracking-wider",
                                                isCardOrder && "bg-orange-500/10 text-orange-600 border-orange-200",
                                                !isCardOrder && "bg-muted text-muted-foreground border-transparent"
                                            )}>
                                                {isCardOrder ? '堂卡購買' :
                                                    tab === 'leaves' ? '請假紀錄' :
                                                        tab === 'makeups' ? '補課紀錄' : '轉讓紀錄'}
                                            </Badge>
                                            {/* Unified Status Badges */}
                                            {(req.status === 'confirmed' || req.status === 'approved') ? (
                                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-transparent text-[10px] font-bold">
                                                    已核准
                                                </Badge>
                                            ) : req.status === 'rejected' ? (
                                                <Badge variant="secondary" className="bg-red-500/10 text-red-600 border-transparent text-[10px] font-bold">
                                                    已駁回
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="bg-muted text-muted-foreground border-transparent text-[10px] font-semi-bold">
                                                    待審核
                                                </Badge>
                                            )}
                                            <span className="text-[11px] text-muted-foreground/70 font-medium">
                                                申請時間: {format(parseISO(req.created_at), "yyyy/MM/dd HH:mm")}
                                            </span>
                                        </div>

                                        {/* Row 2: Applicant */}
                                        <h3 className="text-[15px] font-bold flex items-center gap-2 text-foreground/90 leading-none">
                                            <User className="h-4 w-4 opacity-40 shrink-0" />
                                            {req.profiles?.name || req.from_profile?.name || '未知使用者'}
                                        </h3>

                                        {/* Row 3: Course / Order Details */}
                                        <div className="flex items-start gap-2.5 text-[13px] sm:text-sm font-medium text-foreground/80 leading-relaxed">
                                            {isCardOrder ? (
                                                <CreditCard className="h-4 w-4 opacity-50 shrink-0 relative top-0.5" />
                                            ) : (
                                                <Calendar className="h-4 w-4 opacity-50 shrink-0 relative top-0.5" />
                                            )}
                                            <span className="flex flex-wrap items-center gap-y-0.5">
                                                {tab === 'leaves' && (
                                                    <>
                                                        <span className="text-muted-foreground/60 mr-1.5 font-bold">[{req.courses?.course_groups?.title}]</span>
                                                        {req.courses?.name} 第 {req.course_sessions?.session_number} 堂 ({req.course_sessions?.session_date})
                                                    </>
                                                )}
                                                {tab === 'makeups' && (
                                                    <>
                                                        <span className="text-muted-foreground/60 mr-1.5 font-bold">[{req.target_courses?.course_groups?.title}]</span>
                                                        從 {req.original_courses?.name} 補至 {req.target_courses?.name} 第 {req.target_sessions?.session_number} 堂 ({req.target_sessions?.session_date})
                                                    </>
                                                )}
                                                {tab === 'transfers' && (
                                                    <>
                                                        <span className="text-muted-foreground/60 mr-1.5 font-bold">[{req.courses?.course_groups?.title}]</span>
                                                        {req.courses?.name} 第 {req.course_sessions?.session_number} 堂 ({req.course_sessions?.session_date}) 轉給 {req.to_profile?.name || req.to_user_name || '現場學員'}
                                                    </>
                                                )}
                                                {tab === 'card_orders' && (
                                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        <span>購買 {req.quantity} 堂卡，金額 ${req.total_amount}</span>
                                                        {req.total_amount > (req.quantity * req.unit_price) && (
                                                            <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-600 border-none px-1.5 h-5 shadow-none">
                                                                包含社員年費
                                                            </Badge>
                                                        )}
                                                    </span>
                                                )}
                                            </span>
                                        </div>

                                        {/* Premium Remittance Info Box (Compact) */}
                                        {isCardOrder && req.remittance_bank_code && (
                                            <div className="mt-3 overflow-hidden rounded-xl border border-muted/30 bg-muted/10">
                                                <div className="flex flex-col sm:flex-row sm:items-center divide-y sm:divide-y-0 sm:divide-x divide-muted/30">
                                                    <div className="flex items-center gap-3 px-4 py-1.5 sm:py-1.5">
                                                        <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-background flex items-center justify-center border border-muted/50 shadow-sm">
                                                            <div className="w-3.5 h-3.5 text-muted-foreground opacity-60">
                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="17"/></svg>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col -space-y-0.5">
                                                            <span className="text-[9px] uppercase tracking-wider font-black text-muted-foreground/60">銀行</span>
                                                            <span className="text-[12px] font-bold text-foreground tabular-nums">{req.remittance_bank_code}</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-3 px-4 py-1.5 sm:py-1.5">
                                                        <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-background flex items-center justify-center border border-muted/50 shadow-sm">
                                                            <div className="w-3.5 h-3.5 text-muted-foreground opacity-60">
                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col -space-y-0.5">
                                                            <span className="text-[9px] uppercase tracking-wider font-black text-muted-foreground/60">末五碼</span>
                                                            <span className="text-[12px] font-bold text-foreground tabular-nums">{req.remittance_account_last5}</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-3 px-4 py-1.5 sm:py-1.5 flex-1">
                                                        <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-background flex items-center justify-center border border-muted/50 shadow-sm">
                                                            <Clock className="w-3.5 h-3.5 text-muted-foreground opacity-60" />
                                                        </div>
                                                        <div className="flex flex-col -space-y-0.5">
                                                            <span className="text-[9px] uppercase tracking-wider font-black text-muted-foreground/60">匯款時間</span>
                                                            <span className="text-[12px] font-bold text-foreground whitespace-nowrap">
                                                                {req.remittance_date ? new Date(req.remittance_date).toLocaleString('zh-TW', { 
                                                                    month: '2-digit', 
                                                                    day: '2-digit', 
                                                                    hour: '2-digit', 
                                                                    minute: '2-digit', 
                                                                    hour12: false 
                                                                }) : '---'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        {isCardOrder && req.status === 'pending' && (
                                            <div className="flex items-center gap-2.5 text-[13px] font-medium text-muted-foreground/80 pl-[1.625rem] pt-1">
                                                <Star className="h-4 w-4 shrink-0 opacity-40" />
                                                <span className="italic">等待學員填寫匯款資訊...</span>
                                            </div>
                                        )}
                                        {!isCardOrder && req.reason && (
                                            <div className="pl-6.5 text-[13px] text-muted-foreground/80 italic border-l-2 border-muted/50 ml-2 mt-1 py-0.5">
                                                {req.reason}
                                            </div>
                                        )}
                                    </div>

                                    {/* Right Side: Action Buttons */}
                                    <div className="shrink-0 flex flex-col sm:flex-row items-center justify-end gap-2 ml-4">
                                        {/* Card Order specific actions */}
                                        {isCardOrder && req.status !== 'rejected' && (
                                            <button
                                                disabled={isPending}
                                                onClick={() => handleRejectCardOrder(req.id, req.status)}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-wider transition-all bg-white text-red-600 shadow-sm border border-transparent hover:bg-red-50 hover:border-red-200 hover:shadow-md active:scale-[0.98] disabled:opacity-50 min-w-[76px]"
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                                駁回
                                            </button>
                                        )}
                                        {isCardOrder && req.status !== 'confirmed' && (
                                            <button
                                                disabled={isPending}
                                                onClick={() => handleConfirmCardOrder(req.id)}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-wider transition-all bg-white text-emerald-600 shadow-sm border border-transparent hover:bg-emerald-50 hover:border-emerald-200 hover:shadow-md active:scale-[0.98] disabled:opacity-50 min-w-[76px]"
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                核准
                                            </button>
                                        )}

                                        {/* Other requests specific actions */}
                                        {!isCardOrder && isPast && (
                                            <button
                                                disabled
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold transition-all bg-muted/50 text-muted-foreground shadow-sm border border-transparent cursor-not-allowed min-w-[76px]"
                                            >
                                                <Ban className="h-4 w-4" />
                                                已過期無法操作
                                            </button>
                                        )}
                                        {!isCardOrder && !isPast && req.status !== 'rejected' && (
                                            <button
                                                disabled={isPending}
                                                onClick={() => handleToggleStatus(req.id, tab as any, req.status)}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-wider transition-all bg-white text-red-600 shadow-sm border border-transparent hover:bg-red-50 hover:border-red-200 hover:shadow-md active:scale-[0.98] disabled:opacity-50 min-w-[76px]"
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                                駁回
                                            </button>
                                        )}
                                        {!isCardOrder && !isPast && req.status === 'rejected' && (
                                            <button
                                                disabled={isPending}
                                                onClick={() => handleToggleStatus(req.id, tab as any, req.status)}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-wider transition-all bg-white text-emerald-600 shadow-sm border border-transparent hover:bg-emerald-50 hover:border-emerald-200 hover:shadow-md active:scale-[0.98] disabled:opacity-50 min-w-[76px]"
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                核准
                                            </button>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </>
    );
}
