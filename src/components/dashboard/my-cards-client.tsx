'use client';

import { useState, useTransition, useMemo } from 'react';
import { Card } from '@/components/ui/card';
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
import { CreditCard, Plus, Minus, CheckCircle2, ChevronLeft, Check, XCircle } from 'lucide-react';
import { cancelCardOrder as _cancelCardOrder, cancelOrder as _cancelOrder, createCardOrderWithRemittance as _createCardOrderWithRemittance, submitRemittanceInfo as _submitRemittanceInfo } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
const cancelCardOrder = safe(_cancelCardOrder);
const cancelOrder = safe(_cancelOrder);
const createCardOrderWithRemittance = safe(_createCardOrderWithRemittance);
const submitRemittanceInfo = safe(_submitRemittanceInfo);
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, ORDER_TYPE_COLORS } from '@/lib/constants';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CardOrder {
    id: string;
    order_type: string;
    quantity: number;
    unit_price: number;
    total_amount: number;
    amount: number | null;
    status: string;
    remittance_bank_code: string | null;
    remittance_account_last5: string | null;
    remittance_date: string | null;
    remittance_note: string | null;
    expires_at: string | null;
    created_at: string;
    confirmed_at: string | null;
    used: number;
    courseNames: string[];
    groupTitle: string | null;
    courseGroupId: string | null;
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
    purchaseUnit: number;
    isMember: boolean;
    bankInfo: string;
}

export function MyCardsClient({
    balance,
    cardPools = [],
    orders,
    isPurchaseOpen,
    priceMember,
    priceNonMember,
    minPurchase,
    purchaseUnit,
    isMember,
    bankInfo,
}: MyCardsClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const [isPurchaseDialogOpen, setIsPurchaseDialogOpen] = useState(false);
    const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
    const [purchaseQty, setPurchaseQty] = useState(purchaseUnit);
    const [includeMembership, setIncludeMembership] = useState(false);
    const [purchaseStep, setPurchaseStep] = useState<1 | 2>(1);

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

    const cardOrders = orders.filter(o => o.order_type === 'card_purchase');
    const activeOrders = cardOrders.filter(o => o.status === 'confirmed');
    const pendingCardOrders = cardOrders.filter(o => o.status === 'pending' || o.status === 'remitted');

    const allOrdersSorted = [...orders].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const [paymentFilter, setPaymentFilter] = useState<'all' | 'card_purchase' | 'course_fee'>('all');
    const filteredOrders = paymentFilter === 'all' ? allOrdersSorted : allOrdersSorted.filter(o => o.order_type === paymentFilter);
    const pendingCount = allOrdersSorted.filter(o => o.status === 'pending' || o.status === 'remitted').length;

    const defaultTab = useMemo(() => {
        const param = searchParams.get('tab');
        if (param === 'payments') return 'payments';
        return 'cards';
    }, [searchParams]);

    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
    const [editBankCode, setEditBankCode] = useState('');
    const [editLast5, setEditLast5] = useState('');
    const [editRemDate, setEditRemDate] = useState('');
    const [editRemNote, setEditRemNote] = useState('');

    const handlePurchase = () => {
        if (!bankCode || bankCode.length < 3) { toast.error('請輸入銀行代碼'); return; }
        if (!last5 || last5.length !== 5) { toast.error('請輸入帳號末五碼'); return; }
        if (!remittanceDate) { toast.error('請選擇匯款時間'); return; }

        startTransition(async () => {
            try {
                const res = await createCardOrderWithRemittance(purchaseQty, includeMembership, bankCode, last5, remittanceDate, remittanceNote || undefined);
                if (res.success) {
                    setIsPurchaseDialogOpen(false);
                    setIsSuccessDialogOpen(true);
                    setPurchaseQty(purchaseUnit);
                    setIncludeMembership(false);
                    setPurchaseStep(1);
                    setBankCode('');
                    setLast5('');
                    const now = new Date();
                    setRemittanceDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
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
                if (res.success) { toast.success(res.message); router.refresh(); }
            } catch (err: any) { toast.error(err.message || '取消失敗'); }
        });
    };

    const handleCancelAnyOrder = (orderId: string) => {
        if (!confirm('確定要取消此訂單？若為課程費訂單，相關報名也會一併取消並釋放名額。')) return;
        startTransition(async () => {
            try {
                const res = await cancelOrder(orderId);
                if (res.success) { toast.success(res.message ?? '訂單已取消'); router.refresh(); }
                else { toast.error(res.message || '取消失敗'); }
            } catch (err: any) { toast.error(err.message || '取消失敗'); }
        });
    };

    const handleSubmitRemittance = (orderId: string) => {
        if (!editBankCode || editBankCode.length < 3) { toast.error('請輸入銀行代碼'); return; }
        if (!editLast5 || editLast5.length !== 5) { toast.error('請輸入帳號末五碼'); return; }
        if (!editRemDate) { toast.error('請選擇匯款時間'); return; }
        startTransition(async () => {
            try {
                const res = await submitRemittanceInfo(orderId, editBankCode, editLast5, editRemDate, editRemNote || undefined);
                if (res.success) { toast.success('匯款資訊已送出'); setEditingOrderId(null); router.refresh(); }
                else { toast.error(res.message || '送出失敗'); }
            } catch (err: any) { toast.error(err.message || '送出失敗'); }
        });
    };

    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());

    const renderOrderCard = (order: CardOrder) => {
        const statusColor = ORDER_STATUS_COLORS[order.status] ?? '';
        const statusLabel = ORDER_STATUS_LABELS[order.status] ?? order.status;
        const typeLabel = ORDER_TYPE_LABELS[order.order_type] ?? order.order_type;
        const typeColor = ORDER_TYPE_COLORS[order.order_type] ?? 'bg-muted text-muted-foreground';
        const isEditable = order.status === 'pending' || order.status === 'remitted';
        const isEditing = editingOrderId === order.id;
        const displayAmount = order.order_type === 'course_fee' ? (order.amount ?? order.total_amount) : order.total_amount;
        const isGroupCardPurchase = order.order_type === 'card_purchase' && !!order.courseGroupId;
        const summary = order.order_type === 'card_purchase'
            ? isGroupCardPurchase ? `整期報名購卡 ×${order.quantity}` : `堂卡購買 ×${order.quantity}`
            : order.courseNames.length > 0
                ? order.courseNames.join('、')
                : typeLabel;

        return (
            <Card key={order.id} className={cn(
                "border-muted/60 shadow-sm rounded-xl overflow-hidden transition-all",
                (order.status === 'cancelled' || order.status === 'rejected') && "opacity-60"
            )}>
                <div className="p-4 sm:p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge variant="secondary" className={cn("text-xs h-5 px-1.5 font-medium border-none shrink-0", typeColor)}>
                                    {typeLabel}
                                </Badge>
                                <Badge variant="outline" className={cn("text-xs h-5 px-1.5 border-none font-bold shrink-0", statusColor)}>
                                    {statusLabel}
                                </Badge>
                            </div>
                            {order.groupTitle && (
                                <p className="text-xs text-muted-foreground font-medium">{order.groupTitle}</p>
                            )}
                            <h3 className="text-sm font-bold leading-tight">{summary}</h3>
                            {order.order_type === 'card_purchase' && (
                                <p className="text-xs text-muted-foreground">
                                    {order.quantity} 堂 × NT$ {order.unit_price}
                                    {order.total_amount > (order.quantity * order.unit_price) && ' + 社員年費 NT$ 1,800'}
                                </p>
                            )}
                            {isGroupCardPurchase && order.courseNames.length > 0 && (
                                <div className="text-xs text-muted-foreground">
                                    報名課程：{order.courseNames.join('、')}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">{order.created_at.slice(0, 10)}</p>
                        </div>
                        <p className="text-sm font-black shrink-0 tabular-nums">NT$ {displayAmount.toLocaleString()}</p>
                    </div>

                    {['remitted', 'confirmed', 'rejected'].includes(order.status) && order.remittance_bank_code && !isEditing && (
                        <div className="bg-muted/30 rounded-lg p-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span><span className="text-muted-foreground">銀行</span> {order.remittance_bank_code}</span>
                            <span><span className="text-muted-foreground">末五碼</span> {order.remittance_account_last5}</span>
                            {order.remittance_date && (
                                <span><span className="text-muted-foreground">匯款時間</span> {new Date(order.remittance_date).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                            )}
                        </div>
                    )}

                    {order.status === 'rejected' && (
                        <p className="text-xs text-destructive">此筆繳費已被駁回，如有疑問請聯繫幹部。</p>
                    )}

                    {isEditing && (
                        <div className="bg-muted/20 rounded-lg p-3 border border-muted/50 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-xs font-bold text-muted-foreground mb-1 block">銀行代碼</label>
                                    <Input value={editBankCode} onChange={e => setEditBankCode(e.target.value)} placeholder="例 012" className="h-8 text-xs" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-muted-foreground mb-1 block">帳號末五碼</label>
                                    <Input value={editLast5} onChange={e => setEditLast5(e.target.value)} maxLength={5} placeholder="12345" className="h-8 text-xs" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted-foreground mb-1 block">匯款時間</label>
                                <Input type="datetime-local" value={editRemDate} onChange={e => setEditRemDate(e.target.value)} className="h-8 text-xs" />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted-foreground mb-1 block">備註（選填）</label>
                                <Input value={editRemNote} onChange={e => setEditRemNote(e.target.value)} placeholder="例：ATM 轉帳" className="h-8 text-xs" />
                            </div>
                            <div className="flex gap-2 justify-end">
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingOrderId(null)}>取消</Button>
                                <Button size="sm" className="h-7 text-xs" onClick={() => handleSubmitRemittance(order.id)} disabled={isPending}>送出匯款資訊</Button>
                            </div>
                        </div>
                    )}

                    {isEditable && !isEditing && (
                        <div className="flex gap-2 justify-end pt-1">
                            {order.status === 'pending' && (
                                <Button variant="outline" size="sm" className="h-7 text-xs font-bold"
                                    onClick={() => { setEditingOrderId(order.id); setEditBankCode(order.remittance_bank_code ?? ''); setEditLast5(order.remittance_account_last5 ?? ''); setEditRemDate(''); setEditRemNote(''); }}>
                                    補匯款
                                </Button>
                            )}
                            {order.status === 'remitted' && (
                                <Button variant="outline" size="sm" className="h-7 text-xs font-bold"
                                    onClick={() => { setEditingOrderId(order.id); setEditBankCode(order.remittance_bank_code ?? ''); setEditLast5(order.remittance_account_last5 ?? ''); setEditRemDate(order.remittance_date ?? ''); setEditRemNote(order.remittance_note ?? ''); }}>
                                    更正匯款
                                </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 text-xs font-bold text-destructive hover:bg-destructive/10"
                                onClick={() => handleCancelAnyOrder(order.id)} disabled={isPending}>
                                <XCircle className="h-3.5 w-3.5 mr-1" />取消
                            </Button>
                        </div>
                    )}
                </div>
            </Card>
        );
    };

    return (
        <>
            {/* Header */}
            <div className="flex items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0">
                        <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
                    </Button>
                    <div className="space-y-0.5 select-none">
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight leading-none">堂卡與繳費</h1>
                        <p className="text-xs text-muted-foreground font-medium hidden sm:block">查看餘額、購卡與繳費紀錄</p>
                    </div>
                </div>
                <Button size="sm"
                    className="h-9 text-xs font-bold rounded-lg px-4 shrink-0 disabled:opacity-50"
                    onClick={() => { setPurchaseStep(1); setIsPurchaseDialogOpen(true); }}
                    disabled={!isPurchaseOpen}>
                    <Plus className="h-4 w-4 mr-1" />
                    {isPurchaseOpen ? '購買堂卡' : '購買未開放'}
                </Button>
            </div>

            {/* Tabs */}
            <Tabs defaultValue={defaultTab} className="w-full">
                <TabsList className="bg-muted/50 p-1 h-10 border border-muted-foreground/10 mb-6 w-full grid grid-cols-2">
                    <TabsTrigger value="cards" className="text-sm font-bold data-[state=active]:shadow-sm">
                        堂卡
                        {pendingCardOrders.length > 0 && (
                            <span className="ml-1.5 bg-amber-500/20 text-amber-600 px-1.5 py-0.5 text-xs rounded-full leading-none font-bold">
                                {pendingCardOrders.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="payments" className="text-sm font-bold data-[state=active]:shadow-sm">
                        繳費紀錄
                        {pendingCount > 0 && (
                            <span className="ml-1.5 bg-amber-500/20 text-amber-600 px-1.5 py-0.5 text-xs rounded-full leading-none font-bold">
                                {pendingCount}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* ===== 堂卡 Tab ===== */}
                <TabsContent value="cards" className="space-y-4 m-0 border-none p-0 outline-none">
                    {/* Balance */}
                    <Card className="border-muted/40 shadow-md rounded-xl p-6 space-y-4">
                        <div className="flex items-baseline justify-between">
                            <p className="text-sm font-bold text-muted-foreground">可用餘額</p>
                            {cardPools.length > 0 && (() => {
                                const availableBalance = cardPools
                                    .filter(pool => !pool.expires_at || pool.expires_at >= today)
                                    .reduce((sum, pool) => sum + pool.remaining, 0);
                                const expiredCount = balance - availableBalance;
                                if (expiredCount > 0) {
                                    return <p className="text-xs text-amber-600 font-bold">{expiredCount} 堂已過期</p>;
                                }
                                return null;
                            })()}
                        </div>
                        <div className="flex items-baseline gap-2">
                            <p data-testid="card-balance" className="text-5xl font-black tracking-tight">{balance}</p>
                            <span className="text-lg text-muted-foreground/40 font-bold">堂</span>
                        </div>
                        {cardPools.length > 0 && (
                            <p className="text-xs text-muted-foreground">到期日後的課程堂次無法使用該批堂卡報名</p>
                        )}
                    </Card>

                    {/* Active card pools */}
                    {activeOrders.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground px-1">已開通堂卡</h3>
                            {activeOrders.map((order) => {
                                const isExpired = order.expires_at && order.expires_at < today;
                                return (
                                    <Card key={order.id} className={cn("border-muted/60 rounded-xl p-4 flex items-center justify-between gap-3", isExpired && "opacity-50")}>
                                        <div className="space-y-1 min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold">{order.quantity} 堂</span>
                                                <span className="text-xs text-muted-foreground">已用 {order.used} / 剩 {order.quantity - order.used}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <span>{order.confirmed_at?.slice(0, 10) || order.created_at.slice(0, 10)} 開通</span>
                                                {order.expires_at && (
                                                    <span className={isExpired ? "text-red-500 font-bold" : ""}>
                                                        {isExpired ? '已過期' : `${order.expires_at} 到期`}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <Badge variant="outline" className={cn(
                                            "text-xs h-5 px-1.5 border-none font-bold shrink-0",
                                            isExpired ? ORDER_STATUS_COLORS.cancelled : ORDER_STATUS_COLORS.confirmed
                                        )}>
                                            {isExpired ? '已過期' : '使用中'}
                                        </Badge>
                                    </Card>
                                );
                            })}
                        </div>
                    )}

                    {/* Pending card orders */}
                    {pendingCardOrders.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground px-1">待審核</h3>
                            {pendingCardOrders.map((order) => (
                                <Card key={order.id} className="border-muted/60 rounded-xl overflow-hidden">
                                    <div className="p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className={cn("text-xs h-5 px-1.5 border-none font-bold", ORDER_STATUS_COLORS[order.status])}>
                                                    {order.status === 'pending' ? '待匯款' : '待審核'}
                                                </Badge>
                                                <span className="text-sm font-bold">{order.quantity} 堂卡</span>
                                            </div>
                                            <span className="text-sm font-black tabular-nums">NT$ {order.total_amount.toLocaleString()}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {order.quantity} 堂 × NT$ {order.unit_price}
                                            {order.total_amount > (order.quantity * order.unit_price) && " + 社員年費"}
                                            <span className="mx-2 opacity-30">|</span>
                                            {order.created_at.slice(0, 10)}
                                        </p>
                                        {order.status === 'remitted' && order.remittance_bank_code && (
                                            <div className="bg-muted/30 rounded-lg p-2.5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                                                <span><span className="text-muted-foreground">銀行</span> {order.remittance_bank_code}</span>
                                                <span><span className="text-muted-foreground">末五碼</span> {order.remittance_account_last5}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-muted/10 border-t border-muted/30 px-4 py-2.5 flex justify-end">
                                        <Button variant="ghost" size="sm" className="h-7 text-xs font-bold text-destructive hover:bg-destructive/10"
                                            onClick={() => handleCancelOrder(order.id)} disabled={isPending}>
                                            <XCircle className="h-3.5 w-3.5 mr-1" />取消訂單
                                        </Button>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}

                    {activeOrders.length === 0 && pendingCardOrders.length === 0 && balance === 0 && (
                        <div className="text-center py-16 text-muted-foreground">
                            <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-10" />
                            <p className="font-bold text-sm">目前沒有堂卡</p>
                            <p className="text-xs mt-1">點擊右上角「購買堂卡」開始</p>
                        </div>
                    )}
                </TabsContent>

                {/* ===== 繳費紀錄 Tab ===== */}
                <TabsContent value="payments" className="space-y-4 m-0 border-none p-0 outline-none">
                    {bankInfo && (
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-1">
                            <p className="text-xs font-bold text-amber-600">匯款帳號資訊</p>
                            <p className="text-xs text-muted-foreground whitespace-pre-line">{bankInfo}</p>
                        </div>
                    )}

                    {/* Filter chips */}
                    <div className="flex gap-1.5">
                        {([['all', '全部'], ['card_purchase', '堂卡'], ['course_fee', '現金']] as const).map(([key, label]) => (
                            <Button key={key} variant={paymentFilter === key ? 'default' : 'outline'} size="sm"
                                className={cn("h-7 text-xs font-bold rounded-full px-3", paymentFilter !== key && "text-muted-foreground")}
                                onClick={() => setPaymentFilter(key)}>
                                {label}
                            </Button>
                        ))}
                    </div>

                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <p className="font-bold text-sm">尚無繳費紀錄</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredOrders.map(renderOrderCard)}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

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
                            <div className="space-y-3">
                                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/30 border">
                                    <div className="space-y-0.5">
                                        <p className="text-xs text-muted-foreground font-bold">你的身份</p>
                                        <p className="font-bold text-sm">{isMember ? '社員' : '非社員'}</p>
                                    </div>
                                    <div className="text-right space-y-0.5">
                                        <p className="text-xs text-muted-foreground font-bold">單堂價格</p>
                                        <p className={cn("font-bold text-sm", (isMember || includeMembership) ? "text-primary" : "text-foreground")}>
                                            NT$ {(isMember || includeMembership) ? priceMember : priceNonMember}
                                        </p>
                                    </div>
                                </div>

                                {!isMember && (
                                    <div className={cn(
                                        "flex items-center justify-between p-4 rounded-xl border cursor-pointer select-none",
                                        includeMembership ? "bg-primary/10 border-primary/50 ring-1 ring-primary/20" : "bg-muted/10 hover:bg-muted/20 border-muted"
                                    )} onClick={() => setIncludeMembership(!includeMembership)}>
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold flex items-center gap-2">
                                                <div className={cn("h-5 w-5 rounded-full border flex items-center justify-center",
                                                    includeMembership ? "bg-primary border-primary" : "bg-transparent border-muted-foreground/30")}>
                                                    {includeMembership && <Check className="h-3 w-3 text-white stroke-[4]" />}
                                                </div>
                                                加入社員 (本年度)
                                            </span>
                                            <span className={cn("text-xs font-medium mt-0.5 ml-7", includeMembership ? "text-primary/80" : "text-muted-foreground")}>
                                                {includeMembership ? "已享社員優惠價 NT$ 270/堂" : "加入後購卡即享社員價 NT$ 270/堂"}
                                            </span>
                                        </div>
                                        <span className={cn("text-sm font-black", includeMembership ? "text-primary" : "text-foreground")}>+ NT$ 1,800</span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-center gap-6">
                                <Button variant="outline" size="icon" className="h-12 w-12 rounded-full"
                                    onClick={() => setPurchaseQty(Math.max(purchaseUnit, purchaseQty - purchaseUnit))}
                                    disabled={purchaseQty <= purchaseUnit}>
                                    <Minus className="h-5 w-5" />
                                </Button>
                                <div className="text-center">
                                    <p data-testid="purchase-qty" className="text-5xl font-black tracking-tighter">{purchaseQty}</p>
                                    <p className="text-xs text-muted-foreground font-bold mt-1">堂卡</p>
                                </div>
                                <Button variant="outline" size="icon" className="h-12 w-12 rounded-full"
                                    onClick={() => setPurchaseQty(purchaseQty + purchaseUnit)}
                                    disabled={purchaseQty >= 20}>
                                    <Plus className="h-5 w-5" />
                                </Button>
                            </div>

                            <div className="text-center p-4 rounded-xl bg-primary/5 border border-primary/20">
                                <p className="text-xs text-muted-foreground font-bold mb-1">應付總額</p>
                                <p className="text-3xl font-black text-primary">NT$ {totalPrice.toLocaleString()}</p>
                            </div>

                            <p className="text-xs text-muted-foreground text-center leading-relaxed">
                                堂卡有效期與社員資格年度同步，到期後無法用於報名該日期之後的課程堂次。
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6 py-4">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">匯款銀行代碼 *</label>
                                    <Input placeholder="例如：822, 007" maxLength={3} value={bankCode}
                                        onChange={(e) => setBankCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                                        className={cn("h-12 rounded-xl text-center text-lg font-bold", bankCode.length > 0 && bankCode.length < 3 && 'border-red-500/50')} />
                                    {bankCode.length > 0 && bankCode.length < 3 && (
                                        <p className="text-xs text-red-500 font-bold ml-1">請輸入 3 位數銀行代碼</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">匯款帳號末五碼 *</label>
                                    <Input placeholder="請輸入 5 位數字" maxLength={5} value={last5}
                                        onChange={(e) => setLast5(e.target.value.replace(/\D/g, '').slice(0, 5))}
                                        className={cn("h-12 rounded-xl text-center text-lg font-bold", last5.length > 0 && last5.length < 5 && 'border-red-500/50')} />
                                    {last5.length > 0 && last5.length < 5 && (
                                        <p className="text-xs text-red-500 font-bold ml-1">請輸入完整 5 位數字（目前 {last5.length} 位）</p>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">匯款時間 *</label>
                                    <Input type="datetime-local" value={remittanceDate}
                                        onChange={(e) => setRemittanceDate(e.target.value)} className="h-12 rounded-xl" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground ml-1">備註 (選填)</label>
                                    <Input placeholder="例如：使用XX銀行轉帳" value={remittanceNote}
                                        onChange={(e) => setRemittanceNote(e.target.value)} className="h-12 rounded-xl" />
                                </div>
                            </div>
                            <div className="text-center p-4 rounded-xl bg-primary/5 border border-primary/20">
                                <p className="text-xs text-muted-foreground font-bold mb-1">應付總額</p>
                                <p className="text-3xl font-black text-primary">NT$ {totalPrice.toLocaleString()}</p>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="flex flex-row gap-3 pt-4 border-t border-muted/20">
                        {purchaseStep === 1 ? (
                            <Button variant="outline" className="flex-1 font-bold h-12 rounded-xl" onClick={() => setIsPurchaseDialogOpen(false)}>取消</Button>
                        ) : (
                            <Button variant="outline" className="flex-1 font-bold h-12 rounded-xl" onClick={() => setPurchaseStep(1)}>上一步</Button>
                        )}
                        {purchaseStep === 1 ? (
                            <Button className="flex-1 font-bold h-12 rounded-xl" onClick={() => setPurchaseStep(2)}>下一步</Button>
                        ) : (
                            <Button className="flex-1 font-bold h-12 rounded-xl"
                                onClick={handlePurchase}
                                disabled={isPending || bankCode.length < 3 || last5.length !== 5 || !remittanceDate}>
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
                            <DialogDescription className="text-base text-center">請靜候對帳開通，系統將自動入帳。</DialogDescription>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button className="w-full font-bold h-12 rounded-xl" onClick={() => setIsSuccessDialogOpen(false)}>我知道了</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
