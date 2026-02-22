'use client';

import { useState, useTransition } from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { Check, Calendar, Loader2, Star, ClipboardList, X, CreditCard, User } from "lucide-react";
import { confirmCardOrder, reviewLeaveRequest, reviewMakeupRequest, reviewTransferRequest } from '@/lib/supabase/actions';
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
                                            {!isCardOrder && req.status === 'rejected' && (
                                                <Badge variant="secondary" className="bg-red-500/10 text-red-600 border-transparent text-[10px] font-bold">
                                                    已駁回
                                                </Badge>
                                            )}
                                            {!isCardOrder && req.status !== 'rejected' && (
                                                <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-transparent text-[10px] font-bold">
                                                    已核准
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
                                                {tab === 'card_orders' && `購買 ${req.quantity} 堂卡，金額 $${req.total_amount}`}
                                            </span>
                                        </div>

                                        {/* Conditional Rows: Reason / Remittance Info */}
                                        {isCardOrder && (
                                            <div className="flex items-center gap-2.5 text-[13px] font-medium text-orange-600/90 pl-6.5 pt-0.5">
                                                <Star className="h-4 w-4 shrink-0" />
                                                <span>末五碼: {req.remittance_account_last5 || '尚未填打'}</span>
                                                <span className="text-muted-foreground font-normal ml-1">({req.status === 'remitted' ? '已填匯款資訊' : '待填寫'})</span>
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
                                        {!isCardOrder && req.status !== 'rejected' && (
                                            <button
                                                disabled={isPending}
                                                onClick={() => handleToggleStatus(req.id, tab as any, req.status)}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-wider transition-all bg-white text-red-600 shadow-sm border border-transparent hover:bg-red-50 hover:border-red-200 hover:shadow-md active:scale-[0.98] disabled:opacity-50 min-w-[76px]"
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                                駁回
                                            </button>
                                        )}
                                        {!isCardOrder && req.status === 'rejected' && (
                                            <button
                                                disabled={isPending}
                                                onClick={() => handleToggleStatus(req.id, tab as any, req.status)}
                                                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-black uppercase tracking-wider transition-all bg-white text-emerald-600 shadow-sm border border-transparent hover:bg-emerald-50 hover:border-emerald-200 hover:shadow-md active:scale-[0.98] disabled:opacity-50 min-w-[76px]"
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                                核准
                                            </button>
                                        )}
                                        {isCardOrder && req.status !== 'confirmed' && (
                                            <Button
                                                className="h-10 px-5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm font-bold tracking-wider"
                                                disabled={isPending}
                                                onClick={() => handleConfirmCardOrder(req.id)}
                                            >
                                                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                                                確認收款
                                            </Button>
                                        )}
                                        {isCardOrder && req.status === 'confirmed' && (
                                            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-transparent text-[13px] font-black py-1.5 px-3 rounded-lg shadow-sm">
                                                <Check className="h-4 w-4 mr-1.5" /> 已核發
                                            </Badge>
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
