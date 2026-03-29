'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '@/components/ui/dialog';
import { CreditCard, Plus, Minus, Clock, AlertCircle, CheckCircle2, ChevronLeft, Check, XCircle } from 'lucide-react';
import { cancelCardOrder as _cancelCardOrder, createCardOrderWithRemittance as _createCardOrderWithRemittance } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
const cancelCardOrder = safe(_cancelCardOrder);
const createCardOrderWithRemittance = safe(_createCardOrderWithRemittance);
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CardOrder {
    id: string;
    quantity: number;
    unit_price: number;
    total_amount: number;
    status: string;
    remittance_bank_code: string | null;
    remittance_account_last5: string | null;
    remittance_date: string | null;
    remittance_note: string | null;
    expires_at: string | null;
    created_at: string;
    confirmed_at: string | null;
    used: number;
}

interface CardPoolInfo {
    remaining: number;
    expires_at: string | null;
}

interface MyCardsClientProps {
    balance: number;
    cardPools?: CardPoolInfo[];
    orders: CardOrder[];
    isPurchaseOpen: boolean;
    priceMember: number;
    priceNonMember: number;
    minPurchase: number;
    isMember: boolean;
    bankInfo: string;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    pending: { label: '待匯款', color: 'text-yellow-600 border-yellow-500/30 bg-yellow-500/5' },
    remitted: { label: '財務審核中', color: 'text-orange-600 border-orange-500/30 bg-orange-500/5' },
    confirmed: { label: '已開通', color: 'text-green-600 border-green-500/30 bg-green-500/5' },
    cancelled: { label: '已取消', color: 'text-muted-foreground border-muted' },
};

export function MyCardsClient({
    balance,
    cardPools = [],
    orders,
    isPurchaseOpen,
    priceMember,
    priceNonMember,
    minPurchase,
    isMember,
    bankInfo,
}: MyCardsClientProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    // Purchase Dialog
    const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false);
    const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
    const [purchaseQty, setPurchaseQty] = useState(5);
    const [includeMembership, setIncludeMembership] = useState(false);
    const [purchaseStep, setPurchaseStep] = useState<1 | 2>(1);

    // Remittance Info (shared across purchase flow)
    const [bankCode, setBankCode] = useState('');
    const [last5, setLast5] = useState('');
    const [remittanceDate, setRemittanceDate] = useState(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    });
    const [remittanceNote, setRemittanceNote] = useState('');

    const unitPrice = (isMember || includeMembership) ? priceMember : priceNonMember;
    const membershipPrice = includeMembership ? 1800 : 0;
    const totalPrice = (purchaseQty * unitPrice) + membershipPrice;

    const activeOrders = orders.filter(o => o.status === 'confirmed');
    const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'remitted');
    const historyOrders = orders.filter(o => o.status === 'cancelled');

    const handlePurchase = () => {
        if (!bankCode || bankCode.length < 3) {
            toast.error('請輸入銀行代碼');
            return;
        }
        if (!last5 || last5.length !== 5) {
            toast.error('請輸入帳號末五碼');
            return;
        }
        if (!remittanceDate) {
            toast.error('請選擇匯款時間');
            return;
        }

        startTransition(async () => {
            try {
                const res = await createCardOrderWithRemittance(
                    purchaseQty, 
                    includeMembership,
                    bankCode,
                    last5,
                    remittanceDate,
                    remittanceNote || undefined
                );
                if (res.success) {
                    setIsPurchaseDialogOpen(false);
                    setIsSuccessDialogOpen(true);
                    setPurchaseQty(5);
                    setIncludeMembership(false);
                    setPurchaseStep(1);
                    setBankCode('');
                    setLast5('');
                    // Reset to current time after purchase
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const hours = String(now.getHours()).padStart(2, '0');
                    const minutes = String(now.getMinutes()).padStart(2, '0');
                    setRemittanceDate(`${year}-${month}-${day}T${hours}:${minutes}`);
                    setRemittanceNote('');
                    router.refresh();
                }
            } catch (err: any) {
                toast.error(err.message || '購買失敗');
            }
        });
    };

    const handleCancelOrder = (orderId: string) => {
        if (!confirm('確定要取消此訂單嗎？')) return;
        startTransition(async () => {
            try {
                const res = await cancelCardOrder(orderId);
                if (res.success) {
                    toast.success(res.message);
                    router.refresh();
                }
            } catch (err: any) {
                toast.error(err.message || '取消失敗');
            }
        });
    };

    return (
        <>
            {/* Header Row: Title on left, Purchase Button on right */}
            <div className="flex flex-row items-center justify-between gap-2 sm:gap-6 mb-4 px-4 sm:px-0 w-full max-w-lg mx-auto">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0">
                        <Link href="/dashboard">
                            <ChevronLeft className="h-6 w-6" />
                        </Link>
                    </Button>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20 hidden sm:flex">
                            <CreditCard className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-xl sm:text-2xl font-bold tracking-tight leading-none text-foreground">我的堂卡</h1>
                            <p className="text-[11px] sm:text-[13px] text-muted-foreground font-medium hidden sm:block">
                                管理餘額、購卡與紀錄
                            </p>
                        </div>
                    </div>
                </div>

                <Button
                    size="sm"
                    className="h-9 sm:h-10 text-xs sm:text-sm font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-md transition-all active:scale-95 px-4 sm:px-6 w-auto shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                        setPurchaseStep(1);
                        setIsPurchaseDialogOpen(true);
                    }}
                    disabled={!isPurchaseOpen}
                >
                    <Plus className="h-4 w-4 mr-1.5" />
                    {isPurchaseOpen ? '立即購卡' : '購買未開放'}
                </Button>
            </div>

            {/* Tabs */}
            <div className="w-full max-w-lg mx-auto mt-6 sm:mt-8">
                <Tabs defaultValue="active" className="w-full">
                    <div className="flex justify-center mb-8 px-4 sm:px-0">
                        <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 w-full grid grid-cols-3 sm:flex sm:grid-cols-none sm:w-auto">
                            <TabsTrigger value="pending" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm flex items-center gap-1.5 focus:outline-none">
                                未開通
                                {pendingOrders.length > 0 && (
                                    <span className="bg-muted-foreground/20 px-1.5 py-0.5 text-[9px] rounded-full leading-none">
                                        {pendingOrders.length}
                                    </span>
                                )}
                            </TabsTrigger>
                            <TabsTrigger value="active" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm focus:outline-none">使用中</TabsTrigger>
                            <TabsTrigger value="history" className="text-[12px] sm:text-sm font-bold px-4 data-[state=active]:shadow-sm focus:outline-none">歷史/已取消</TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="space-y-6 px-4 sm:px-0">
                        <TabsContent value="active" className="space-y-6 m-0 border-none p-0 outline-none">
                            {activeOrders.length === 0 && balance === 0 ? (
                                <div className="text-center py-24 bg-muted/10 rounded-3xl border border-dashed border-muted">
                                    <CreditCard className="h-10 w-10 mx-auto mb-4 opacity-10" />
                                    <p className="text-muted-foreground font-bold">目前沒有可用的堂卡</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <Card className="bg-gradient-to-br from-card to-background border border-muted/40 shadow-2xl rounded-[2.5rem] p-8 sm:p-10 space-y-6 relative overflow-hidden group/card hover:border-orange-500/20 transition-colors duration-500 min-h-[220px] flex flex-col justify-center">
                                        {/* Premium background hint */}
                                        <div className="absolute -top-24 -left-24 w-64 h-64 bg-orange-500/5 blur-[100px] pointer-events-none" />
                                        <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-br from-orange-500/[0.01] to-transparent pointer-events-none" />
                                        
                                        {/* Large artful icon with dynamic hover */}
                                        <div className="absolute top-1/2 -right-16 -translate-y-[55%] opacity-[0.03] pointer-events-none group-hover/card:opacity-[0.06] transition-all duration-700">
                                            <CreditCard className="h-80 w-80 sm:h-[28rem] sm:w-[28rem] -rotate-[15deg] text-foreground" />
                                        </div>
                                        
                                        <div className="space-y-1 relative">
                                            <h2 className="text-xl sm:text-2xl font-black tracking-tight opacity-90">目前的總剩餘堂數</h2>
                                        </div>
                                        
                                        <div className="flex items-baseline gap-3 relative">
                                            <p className="text-7xl sm:text-8xl font-black tracking-tighter bg-gradient-to-b from-foreground to-foreground/80 bg-clip-text">
                                                {balance}
                                            </p>
                                            <span className="text-xl sm:text-2xl opacity-20 font-bold tracking-widest">堂卡</span>
                                        </div>
                                        
                                        {cardPools.length > 0 && (
                                            <div className="pt-6 border-t border-muted/10 space-y-2 relative">
                                                {(() => {
                                                    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
                                                    const availableBalance = cardPools
                                                        .filter(pool => !pool.expires_at || pool.expires_at >= today)
                                                        .reduce((sum, pool) => sum + pool.remaining, 0);
                                                    const expiredCount = balance - availableBalance;
                                                    
                                                    if (expiredCount > 0) {
                                                        return (
                                                            <div className="flex items-center gap-2">
                                                                <div className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                                                                <p className="text-[11px] text-orange-600/90 font-black tracking-wide">
                                                                    扣除已過期後可用於報名：{availableBalance} 堂 ({expiredCount} 堂已過期)
                                                                </p>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                })()}
                                                <p className="text-[11px] text-foreground/20 font-bold leading-relaxed max-w-[90%] tracking-tight">
                                                    * 到期日後的課程堂次無法使用該批堂卡報名
                                                </p>
                                            </div>
                                        )}
                                    </Card>

                                    {activeOrders.map((order) => (
                                        <Card key={order.id} className="border-muted/60 bg-muted/5 shadow-sm overflow-hidden relative group hover:border-orange-600/30 transition-all rounded-xl p-5 sm:p-6 flex flex-row items-center justify-between gap-4">
                                            <div className="space-y-1 min-w-0 flex-1">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/60 truncate">Purchase ID: {order.id.slice(0, 8)}</p>
                                                <h3 className="text-sm sm:text-base font-bold">
                                                    已開通: {order.quantity} 堂課卡
                                                </h3>
                                                <p className="text-[11px] sm:text-xs text-muted-foreground font-medium">
                                                    已使用 {order.used} 堂 | 剩餘 {order.quantity - order.used} 堂
                                                </p>
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-[10px] sm:text-[11px] text-muted-foreground font-medium tracking-wider">
                                                    <span className="whitespace-nowrap">購於 {order.confirmed_at?.slice(0, 10) || order.created_at.slice(0, 10)}</span>
                                                    {(() => {
                                                        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
                                                        const isExpired = order.expires_at && order.expires_at < today;
                                                        
                                                        if (!order.expires_at) return null;
                                                        
                                                        return (
                                                            <>
                                                                <span className="hidden sm:inline opacity-30">|</span>
                                                                <span className={cn(
                                                                    "whitespace-nowrap",
                                                                    isExpired ? "text-red-500/90 font-black" : "opacity-60"
                                                                )}>
                                                                    {isExpired ? '已過期' : '到期'} {order.expires_at}
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <Badge variant="outline" className="border-green-500/30 text-green-600 bg-green-500/5 font-bold mb-1 border-none px-1.5 h-5 text-[10px] uppercase tracking-widest">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" /> 已生效
                                                </Badge>
                                                <p className="text-xs sm:text-sm text-foreground font-black mt-1">NT$ {order.total_amount}</p>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="pending" className="space-y-6 m-0 border-none p-0 outline-none">
                            {pendingOrders.length === 0 ? (
                                <div className="text-center py-20 bg-muted/5 rounded-3xl border border-dashed border-muted text-muted-foreground font-bold">
                                    沒有待審核的項目
                                </div>
                            ) : (
                                pendingOrders.map((order) => {
                                    const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.pending;
                                    return (
                                        <Card key={order.id} className="border-muted/60 bg-muted/5 rounded-xl overflow-hidden flex flex-col">
                                            <div className="p-5 sm:p-6 space-y-4 sm:space-y-5">
                                                <div className="space-y-1.5 w-full">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Badge variant="outline" className={cn("font-bold text-[10px] h-5 px-1.5 border-none", statusInfo.color)}>
                                                            {statusInfo.label}
                                                        </Badge>
                                                        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-muted-foreground opacity-60">
                                                            Order {order.id.slice(0, 8)}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                                                        <h2 className="text-xl sm:text-2xl font-black">{order.quantity} 堂卡</h2>
                                                        <span className="text-lg sm:text-xl font-bold tracking-tight text-foreground/80 mt-1 sm:mt-0">NT$ {order.total_amount}</span>
                                                    </div>
                                                    <p className="text-[11px] sm:text-xs text-muted-foreground font-medium pt-1">
                                                        包含 {order.quantity} 堂 × NT$ {order.unit_price}
                                                        {order.total_amount > (order.quantity * order.unit_price) && " + 社員年費"}
                                                    </p>
                                                </div>

                                                {order.status === 'remitted' && (
                                                    <div className="bg-background rounded-xl p-3 sm:p-4 border border-muted/50 text-[11px] sm:text-xs flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2">
                                                        <div className="flex items-center gap-1.5 font-bold text-foreground shrink-0">
                                                            <CheckCircle2 className="h-4 w-4 text-orange-600" />
                                                            已匯款資訊
                                                        </div>
                                                        <div className="text-muted-foreground font-medium leading-relaxed sm:border-l sm:pl-4 sm:border-muted/60 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                                            <span className="flex items-center gap-1.5"><span className="text-foreground text-[10px] uppercase font-bold tracking-wider opacity-60">銀行</span> {order.remittance_bank_code}</span>
                                                            <span className="flex items-center gap-1.5"><span className="text-foreground text-[10px] uppercase font-bold tracking-wider opacity-60">末五碼</span> {order.remittance_account_last5}</span>
                                                            <span className="flex items-center gap-1.5 w-full sm:w-auto"><span className="text-foreground text-[10px] uppercase font-bold tracking-wider opacity-60">時間</span> {order.remittance_date ? new Date(order.remittance_date).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="bg-muted/10 border-t border-muted/30 p-3 sm:p-4 flex justify-end">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive h-9 px-4 text-xs font-bold transition-all"
                                                    onClick={() => handleCancelOrder(order.id)}
                                                    disabled={isPending}
                                                >
                                                    <XCircle className="h-4 w-4 mr-1.5" />
                                                    取消訂單
                                                </Button>
                                            </div>
                                        </Card>
                                    );
                                })
                            )}
                        </TabsContent>

                        <TabsContent value="history" className="space-y-4 m-0 border-none p-0 outline-none">
                            {historyOrders.length === 0 ? (
                                <div className="text-center py-20 bg-muted/5 rounded-3xl border border-dashed border-muted text-muted-foreground font-bold">
                                    沒有歷史訂單
                                </div>
                            ) : (
                                historyOrders.map((order) => (
                                    <div key={order.id} className="p-5 sm:p-6 rounded-xl border border-muted bg-muted/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 opacity-50 grayscale transition-all">
                                        <div className="space-y-1">
                                            <h3 className="font-bold line-through text-sm sm:text-base">{order.quantity} 堂卡</h3>
                                            <div className="flex gap-3 text-[10px] font-bold text-muted-foreground uppercase">
                                                <span>{order.created_at.slice(0, 10)} 購</span>
                                                {order.expires_at && <span>{order.expires_at} 止</span>}
                                            </div>
                                        </div>
                                        <Badge variant="secondary" className="font-bold border-none px-2 h-6 text-[11px]">{STATUS_MAP[order.status]?.label || '已取消'}</Badge>
                                    </div>
                                ))
                            )}
                        </TabsContent>
                    </div>
                </Tabs>
            </div>

            {/* Purchase Dialog */}
            <Dialog open={isPurchaseDialogOpen} onOpenChange={setIsPurchaseDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>{purchaseStep === 1 ? '購買堂卡' : '填寫匯款資訊'}</DialogTitle>
                        <DialogDescription>
                            {purchaseStep === 1 
                                ? '選擇購買數量，以 5 堂為單位，最低 5 堂，最高 20 堂'
                                : '匯款完成後填寫以下資訊，財務將進行對帳'
                            }
                        </DialogDescription>
                    </DialogHeader>

                    {purchaseStep === 1 ? (
                        <div className="space-y-6 py-4">
                            {/* Identity & Price */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border">
                                    <div className="space-y-0.5">
                                        <p className="text-xs text-muted-foreground font-bold">你的身份</p>
                                        <p className="font-bold text-sm">{isMember ? '社員' : '非社員'}</p>
                                    </div>
                                    <div className="text-right space-y-0.5">
                                        <p className="text-xs text-muted-foreground font-bold">單堂價格</p>
                                        <p className={cn(
                                            "font-bold text-sm transition-colors",
                                            (isMember || includeMembership) ? "text-orange-600" : "text-foreground"
                                        )}>
                                            NT$ {(isMember || includeMembership) ? priceMember : priceNonMember}
                                        </p>
                                    </div>
                                </div>

                                {/* Join Membership Option */}
                                {!isMember && (
                                    <div 
                                        className={cn(
                                            "flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer select-none",
                                            includeMembership ? "bg-orange-500/10 border-orange-600/50 ring-1 ring-orange-600/20" : "bg-muted/10 hover:bg-muted/20 border-muted"
                                        )}
                                        onClick={() => setIncludeMembership(!includeMembership)}
                                    >
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold flex items-center gap-2">
                                                <div className={cn(
                                                    "h-5 w-5 rounded-full border flex items-center justify-center transition-all",
                                                    includeMembership ? "bg-orange-600 border-orange-600" : "bg-transparent border-muted-foreground/30"
                                                )}>
                                                    {includeMembership && <Check className="h-3 w-3 text-white stroke-[4]" />}
                                                </div>
                                                加入社員 (本年度)
                                            </span>
                                            <span className={cn(
                                                "text-[10px] font-medium mt-0.5 ml-7",
                                                includeMembership ? "text-orange-600/80" : "text-muted-foreground"
                                            )}>
                                                {includeMembership ? "已享社員優惠價 NT$ 270/堂" : "加入後購卡即享社員價 NT$ 270/堂"}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <span className={cn("text-sm font-black", includeMembership ? "text-orange-600" : "text-foreground")}>
                                                + NT$ 1,800
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Quantity Selector */}
                            <div className="flex items-center justify-center gap-6">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-12 w-12 rounded-full text-lg font-bold"
                                    onClick={() => setPurchaseQty(Math.max(5, purchaseQty - 5))}
                                    disabled={purchaseQty <= 5}
                                >
                                    <Minus className="h-5 w-5" />
                                </Button>
                                <div className="text-center">
                                    <p className="text-5xl font-black tracking-tighter">{purchaseQty}</p>
                                    <p className="text-xs text-muted-foreground font-bold mt-1">堂卡</p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="h-12 w-12 rounded-full text-lg font-bold"
                                    onClick={() => setPurchaseQty(Math.min(20, purchaseQty + 5))}
                                    disabled={purchaseQty >= 20}
                                >
                                    <Plus className="h-5 w-5" />
                                </Button>
                            </div>

                            {/* Total */}
                            <div className="text-center p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
                                <p className="text-xs text-muted-foreground font-bold mb-1">應付總額</p>
                                <p className="text-3xl font-black text-orange-600">NT$ {totalPrice.toLocaleString()}</p>
                            </div>

                            <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                                堂卡有效期至購買當年度年底，到期後無法用於報名該日期之後的課程堂次。
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6 py-4">


                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">匯款銀行代碼 *</label>
                                    <Input
                                        placeholder="例如：822, 007"
                                        maxLength={3}
                                        value={bankCode}
                                        onChange={(e) => setBankCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                                        className={`h-12 rounded-xl text-center text-lg font-bold border-muted-foreground/20 focus:border-orange-600/50 ${bankCode.length > 0 && bankCode.length < 3 ? 'border-red-500/50' : ''}`}
                                    />
                                    {bankCode.length > 0 && bankCode.length < 3 && (
                                        <p className="text-[11px] text-red-500 font-bold ml-1">請輸入 3 位數銀行代碼</p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">匯款帳號末五碼 *</label>
                                    <Input
                                        placeholder="請輸入 5 位數字"
                                        maxLength={5}
                                        value={last5}
                                        onChange={(e) => setLast5(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                        className={`h-12 rounded-xl text-center text-lg font-bold border-muted-foreground/20 focus:border-orange-600/50 ${last5.length > 0 && last5.length < 5 ? 'border-red-500/50' : ''}`}
                                    />
                                    {last5.length > 0 && last5.length < 5 && (
                                        <p className="text-[11px] text-red-500 font-bold ml-1">請輸入完整 5 位數字（目前 {last5.length} 位）</p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">匯款時間 *</label>
                                    <Input
                                        type="datetime-local"
                                        value={remittanceDate}
                                        onChange={(e) => setRemittanceDate(e.target.value)}
                                        className="h-12 rounded-xl border-muted-foreground/20 focus:border-orange-600/50"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">備註 (選填)</label>
                                    <Input
                                        placeholder="例如：使用XX銀行轉帳"
                                        value={remittanceNote}
                                        onChange={(e) => setRemittanceNote(e.target.value)}
                                        className="h-12 rounded-xl border-muted-foreground/20 focus:border-orange-600/50"
                                    />
                                </div>
                            </div>

                            <div className="text-center p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
                                <p className="text-xs text-muted-foreground font-bold mb-1">應付總額</p>
                                <p className="text-3xl font-black text-orange-600">NT$ {totalPrice.toLocaleString()}</p>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex flex-row gap-3 pt-4 border-t border-muted/20">
                        {purchaseStep === 1 ? (
                            <Button 
                                variant="outline" 
                                className="flex-1 font-bold h-12 rounded-xl border-muted-foreground/20" 
                                onClick={() => setIsPurchaseDialogOpen(false)}
                            >
                                取消
                            </Button>
                        ) : (
                            <Button 
                                variant="outline" 
                                className="flex-1 font-bold h-12 rounded-xl border-muted-foreground/20" 
                                onClick={() => setPurchaseStep(1)}
                            >
                                上一步
                            </Button>
                        )}
                        
                        {purchaseStep === 1 ? (
                            <Button
                                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 rounded-xl shadow-md transition-all active:scale-95"
                                onClick={() => setPurchaseStep(2)}
                            >
                                下一步
                            </Button>
                        ) : (
                            <Button
                                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                                onClick={handlePurchase}
                                disabled={isPending || bankCode.length < 3 || last5.length !== 5 || !remittanceDate}
                            >
                                {isPending ? '處理中...' : '確認購買'}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Success Dialog */}
            <Dialog open={isSuccessDialogOpen} onOpenChange={setIsSuccessDialogOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <div className="py-10 text-center space-y-4">
                        <div className="h-20 w-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto text-green-600">
                            <CheckCircle2 className="h-12 w-12" />
                        </div>
                        <div className="space-y-2">
                            <DialogTitle className="text-2xl font-black text-center">訂單已建立</DialogTitle>
                            <DialogDescription className="text-base text-center">
                                請靜候對帳開通，系統將自動入帳。
                            </DialogDescription>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold h-12 rounded-xl"
                            onClick={() => setIsSuccessDialogOpen(false)}
                        >
                            我知道了
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
