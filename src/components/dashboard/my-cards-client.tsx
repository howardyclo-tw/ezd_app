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
import { CreditCard, CalendarDays, Plus, Minus, Clock, AlertCircle, CheckCircle2, ChevronLeft } from 'lucide-react';
import { createCardOrder, submitRemittanceInfo } from '@/lib/supabase/actions';
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
    remittance_account_last5: string | null;
    remittance_date: string | null;
    remittance_note: string | null;
    expires_at: string | null;
    created_at: string;
    confirmed_at: string | null;
}

interface MyCardsClientProps {
    balance: number;
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
    const [purchaseQty, setPurchaseQty] = useState(minPurchase);

    // Remittance Dialog
    const [remittanceOrderId, setRemittanceOrderId] = useState<string | null>(null);
    const [last5, setLast5] = useState('');
    const [remittanceDate, setRemittanceDate] = useState('');
    const [remittanceNote, setRemittanceNote] = useState('');

    const unitPrice = isMember ? priceMember : priceNonMember;
    const totalPrice = purchaseQty * unitPrice;

    const activeOrders = orders.filter(o => o.status === 'confirmed');
    const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'remitted');
    const historyOrders = orders.filter(o => o.status === 'cancelled');

    const handlePurchase = () => {
        startTransition(async () => {
            try {
                const res = await createCardOrder(purchaseQty);
                if (res.success) {
                    toast.success(res.message);
                    setIsPurchaseDialogOpen(false);
                    setPurchaseQty(minPurchase);
                    router.refresh();
                }
            } catch (err: any) {
                toast.error(err.message || '購買失敗');
            }
        });
    };

    const handleRemittance = () => {
        if (!remittanceOrderId) return;
        if (!last5 || last5.length !== 5) {
            toast.error('請輸入帳號末五碼');
            return;
        }
        if (!remittanceDate) {
            toast.error('請選擇匯款日期');
            return;
        }
        startTransition(async () => {
            try {
                const res = await submitRemittanceInfo(
                    remittanceOrderId,
                    last5,
                    remittanceDate,
                    remittanceNote || undefined
                );
                if (res.success) {
                    toast.success(res.message);
                    setRemittanceOrderId(null);
                    setLast5('');
                    setRemittanceDate('');
                    setRemittanceNote('');
                    router.refresh();
                }
            } catch (err: any) {
                toast.error(err.message || '送出失敗');
            }
        });
    };

    return (
        <>
            {/* Header Row: Title on left, Purchase Button on right */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-2">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0">
                        <Link href="/dashboard">
                            <ChevronLeft className="h-6 w-6" />
                        </Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <CreditCard className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">我的堂卡</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">
                                管理餘額、購卡與紀錄
                            </p>
                        </div>
                    </div>
                </div>

                <Button
                    size="sm"
                    className="h-10 text-sm font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-md transition-all active:scale-95 px-6 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setIsPurchaseDialogOpen(true)}
                    disabled={!isPurchaseOpen}
                >
                    <Plus className="h-4 w-4 mr-2" />
                    {isPurchaseOpen ? '立即購卡' : '購買時段未開放'}
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex justify-center px-4 sm:px-0">
                <Tabs defaultValue="active" className="w-full sm:w-auto">
                    <TabsList className="bg-muted/50 p-1 h-9 border border-muted-foreground/10 w-full grid grid-cols-3 sm:flex sm:grid-cols-none sm:w-auto">
                        <TabsTrigger value="pending" className="text-[12px] sm:text-sm font-bold data-[state=active]:shadow-sm transition-all gap-2 px-4">
                            未開通
                            {pendingOrders.length > 0 && (
                                <span className="bg-muted-foreground/10 px-1.5 py-0.5 text-[10px] rounded-full">
                                    {pendingOrders.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="active" className="text-[12px] sm:text-sm font-bold data-[state=active]:shadow-sm transition-all px-4">使用中</TabsTrigger>
                        <TabsTrigger value="history" className="text-[12px] sm:text-sm font-bold data-[state=active]:shadow-sm transition-all px-4">歷史/已取消</TabsTrigger>
                    </TabsList>

                    <div className="mt-8 space-y-6">
                        {/* Active Tab */}
                        <TabsContent value="active" className="space-y-6 m-0 border-none p-0 outline-none">
                            {activeOrders.length === 0 && balance === 0 ? (
                                <div className="text-center py-24 bg-muted/10 rounded-3xl border border-dashed border-muted">
                                    <CreditCard className="h-10 w-10 mx-auto mb-4 opacity-10" />
                                    <p className="text-muted-foreground font-bold">目前沒有可用的堂卡</p>
                                    <Button
                                        variant="outline"
                                        className="mt-4 font-bold text-orange-600 border-orange-500/30"
                                        onClick={() => {
                                            if (!isPurchaseOpen) {
                                                toast.error('堂卡購買時段尚未開放，請聯繫管理員');
                                                return;
                                            }
                                            setIsPurchaseDialogOpen(true);
                                        }}
                                    >
                                        購買堂卡
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Balance Summary */}
                                    <Card className="bg-card border border-muted/60 shadow-sm rounded-3xl p-8 space-y-8 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-8 opacity-5">
                                            <CreditCard className="h-32 w-32 -rotate-12 translate-x-8 translate-y-8 text-foreground" />
                                        </div>
                                        <div className="space-y-1 relative">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Total Running Balance</p>
                                            <h2 className="text-2xl font-black">目前的總剩餘堂數</h2>
                                        </div>
                                        <div className="flex items-end justify-between relative">
                                            <p className="text-7xl font-black tracking-tighter">
                                                {balance} <span className="text-xl opacity-40 font-bold ml-1">堂卡</span>
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground relative">
                                            <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> 系統即時更新</span>
                                        </div>
                                    </Card>

                                    {/* Confirmed Orders */}
                                    {activeOrders.map((order) => (
                                        <Card key={order.id} className="border-muted/60 bg-muted/5 shadow-sm overflow-hidden relative group hover:border-orange-600/30 transition-all rounded-3xl p-6 flex flex-row items-center justify-between gap-4">
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/60">Purchase ID: {order.id.slice(0, 8)}</p>
                                                <h3 className="text-base font-bold">已開通: {order.quantity} 堂課卡</h3>
                                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                                    購於 {order.confirmed_at?.slice(0, 10) || order.created_at.slice(0, 10)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <Badge variant="outline" className="border-green-500/30 text-green-600 bg-green-500/5 font-bold mb-1">
                                                    <CheckCircle2 className="h-3 w-3 mr-1" /> 已生效
                                                </Badge>
                                                <p className="text-xs text-muted-foreground font-bold">NT$ {order.total_amount}</p>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </TabsContent>

                        {/* Pending Tab */}
                        <TabsContent value="pending" className="space-y-6 m-0 border-none p-0 outline-none">
                            {pendingOrders.length === 0 ? (
                                <div className="text-center py-20 bg-muted/5 rounded-3xl border border-dashed border-muted text-muted-foreground font-bold">
                                    沒有待審核的項目
                                </div>
                            ) : (
                                pendingOrders.map((order) => {
                                    const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.pending;
                                    return (
                                        <Card key={order.id} className="border-muted/60 bg-muted/5 rounded-3xl overflow-hidden p-6 sm:p-8 space-y-5">
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="space-y-1">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/40">
                                                        Order {order.id.slice(0, 8)}
                                                    </p>
                                                    <h2 className="text-xl font-bold tracking-tight">
                                                        {order.quantity} 堂卡
                                                    </h2>
                                                </div>
                                                <Badge variant="outline" className={cn("font-bold shrink-0 gap-1", statusInfo.color)}>
                                                    {order.status === 'pending' && <Clock className="h-3 w-3" />}
                                                    {order.status === 'remitted' && <AlertCircle className="h-3 w-3" />}
                                                    {statusInfo.label}
                                                </Badge>
                                            </div>

                                            <div className="flex items-center justify-between border-t border-muted/40 pt-5">
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">應付總額</p>
                                                    <p className="text-2xl font-bold">NT$ {order.total_amount}</p>
                                                    <p className="text-[11px] text-muted-foreground">
                                                        {order.quantity} 堂 × NT$ {order.unit_price}
                                                    </p>
                                                </div>

                                                {order.status === 'pending' && (
                                                    <Button
                                                        variant="default"
                                                        className="font-bold rounded-xl bg-orange-600 hover:bg-orange-700 text-white"
                                                        onClick={() => {
                                                            setRemittanceOrderId(order.id);
                                                            setLast5('');
                                                            setRemittanceDate('');
                                                            setRemittanceNote('');
                                                        }}
                                                    >
                                                        填寫匯款資訊
                                                    </Button>
                                                )}
                                                {order.status === 'remitted' && (
                                                    <div className="text-right text-xs text-muted-foreground space-y-0.5">
                                                        <p className="font-bold">已回報匯款</p>
                                                        <p>末五碼: {order.remittance_account_last5}</p>
                                                        <p>匯款日: {order.remittance_date}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </Card>
                                    );
                                })
                            )}
                        </TabsContent>

                        {/* History Tab */}
                        <TabsContent value="history" className="space-y-4 m-0 border-none p-0 outline-none">
                            {historyOrders.length === 0 ? (
                                <div className="text-center py-20 bg-muted/5 rounded-3xl border border-dashed border-muted text-muted-foreground font-bold">
                                    沒有歷史訂單
                                </div>
                            ) : (
                                historyOrders.map((order) => (
                                    <div key={order.id} className="p-6 rounded-2xl border border-muted bg-muted/5 flex items-center justify-between opacity-50 grayscale">
                                        <div className="space-y-1">
                                            <h3 className="font-bold line-through">{order.quantity} 堂卡</h3>
                                            <div className="flex gap-4 text-[10px] font-bold text-muted-foreground uppercase">
                                                <span>{order.created_at.slice(0, 10)} 購</span>
                                                {order.expires_at && <span>{order.expires_at} 止</span>}
                                            </div>
                                        </div>
                                        <Badge variant="secondary" className="font-bold">已取消</Badge>
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
                        <DialogTitle>購買堂卡</DialogTitle>
                        <DialogDescription>
                            選擇購買數量，最低 {minPurchase} 堂起購
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                        {/* Identity & Price */}
                        <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border">
                            <div className="space-y-0.5">
                                <p className="text-xs text-muted-foreground font-bold">你的身份</p>
                                <p className="font-bold text-sm">{isMember ? '社員' : '非社員'}</p>
                            </div>
                            <div className="text-right space-y-0.5">
                                <p className="text-xs text-muted-foreground font-bold">單堂價格</p>
                                <p className="font-bold text-sm text-orange-600">NT$ {unitPrice}</p>
                            </div>
                        </div>

                        {/* Quantity Selector */}
                        <div className="flex items-center justify-center gap-6">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-12 w-12 rounded-full text-lg font-bold"
                                onClick={() => setPurchaseQty(Math.max(minPurchase, purchaseQty - 1))}
                                disabled={purchaseQty <= minPurchase}
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
                                onClick={() => setPurchaseQty(purchaseQty + 1)}
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
                            送出後請依指示匯款，財務確認後堂卡將自動入帳。
                            <br />堂卡有效期至購買當年度年底。
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsPurchaseDialogOpen(false)}>取消</Button>
                        <Button
                            className="bg-orange-600 hover:bg-orange-700 text-white font-bold"
                            onClick={handlePurchase}
                            disabled={isPending}
                        >
                            {isPending ? '處理中...' : '確認購買'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Remittance Dialog */}
            <Dialog open={!!remittanceOrderId} onOpenChange={(open) => !open && setRemittanceOrderId(null)}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>填寫匯款資訊</DialogTitle>
                        <DialogDescription>
                            匯款完成後請填寫以下資訊，財務將進行對帳
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {bankInfo && (
                            <div className="p-4 rounded-xl bg-muted/30 border space-y-2">
                                <p className="text-xs font-bold text-muted-foreground">匯款帳戶資訊</p>
                                <p className="text-sm font-bold whitespace-pre-line">{bankInfo}</p>
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-bold">匯款帳號末五碼 *</label>
                            <Input
                                value={last5}
                                onChange={(e) => setLast5(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                placeholder="請輸入 5 位數字"
                                maxLength={5}
                                className="h-11 text-center text-lg tracking-[0.3em] font-bold"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold">匯款日期 *</label>
                            <Input
                                type="date"
                                value={remittanceDate}
                                onChange={(e) => setRemittanceDate(e.target.value)}
                                className="h-11"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold">備註（選填）</label>
                            <Input
                                value={remittanceNote}
                                onChange={(e) => setRemittanceNote(e.target.value)}
                                placeholder="例如：使用XX銀行轉帳"
                                className="h-11"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRemittanceOrderId(null)}>取消</Button>
                        <Button
                            className="bg-orange-600 hover:bg-orange-700 text-white font-bold"
                            onClick={handleRemittance}
                            disabled={isPending || last5.length !== 5 || !remittanceDate}
                        >
                            {isPending ? '送出中...' : '送出匯款資訊'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
