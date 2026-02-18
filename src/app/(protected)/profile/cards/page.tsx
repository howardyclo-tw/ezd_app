import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Clock, CalendarDays, AlertCircle, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// Mock Data
const MOCK_MY_CARDS = [
    {
        id: 'card-001',
        type: 'regular',
        name: '【一般常態課程】 10 堂課卡',
        purchaseDate: '2026-01-15',
        expiryDate: '2026-12-31',
        totalQuota: 10,
        remainingQuota: 8,
        status: 'active', // active, pending, expired
        price: 3000,
    },
    {
        id: 'card-pending-002',
        type: 'regular',
        name: '【一般常態課程】 5 堂課卡',
        purchaseDate: '2026-02-18',
        expiryDate: '-',
        totalQuota: 5,
        remainingQuota: 5,
        status: 'pending', // pending payment or audit
        price: 1500,
    },
    {
        id: 'card-expired-003',
        type: 'trial',
        name: '2025 年度課程卡',
        purchaseDate: '2025-01-01',
        expiryDate: '2025-12-31',
        totalQuota: 20,
        remainingQuota: 0,
        status: 'expired',
        price: 5000,
    },
];

export default async function MyCardsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/login');

    const activeCards = MOCK_MY_CARDS.filter(c => c.status === 'active');
    const pendingCards = MOCK_MY_CARDS.filter(c => c.status === 'pending');
    const expiredCards = MOCK_MY_CARDS.filter(c => c.status === 'expired');

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10 pb-24">
            <div className="space-y-4 mb-10 text-center relative border-b border-muted pb-10">
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-bold tracking-tight text-orange-600">我的堂卡</h1>
                    <p className="text-muted-foreground font-medium text-sm text-balance">管理您的課程餘額、查看購卡紀錄與目前的使用狀況。</p>
                </div>
                <div className="flex justify-center mt-4">
                    <Button size="sm" className="font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-md transition-all active:scale-95 px-8" asChild>
                        <Link href="/topup">立即購卡</Link>
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="active" className="w-full">
                <div className="flex justify-center mb-10">
                    <TabsList className="grid w-full max-w-md grid-cols-3 h-10 bg-muted/50 p-1 border border-muted-foreground/10">
                        <TabsTrigger value="pending" className="font-bold data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all gap-2 text-sm">
                            未開通
                            {pendingCards.length > 0 && (
                                <span className="bg-white/20 px-1.5 py-0.5 text-[10px] rounded-full">
                                    {pendingCards.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="active" className="font-bold data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all text-sm">使用中</TabsTrigger>
                        <TabsTrigger value="expired" className="font-bold data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all text-sm">歷史/失效</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="active" className="space-y-6">
                    {activeCards.length === 0 ? (
                        <div className="text-center py-24 bg-muted/10 rounded-3xl border border-dashed border-muted">
                            <CreditCard className="h-10 w-10 mx-auto mb-4 opacity-10" />
                            <p className="text-muted-foreground font-bold">目前沒有可用的堂卡</p>
                        </div>
                    ) : (
                        activeCards.map((card) => (
                            <Card key={card.id} className="border-muted/60 shadow-sm overflow-hidden relative group hover:border-orange-600/30 transition-all rounded-3xl p-8 space-y-8">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/60 uppercase">Active Pass</p>
                                        <h2 className="text-2xl font-bold tracking-tight">{card.name}</h2>
                                    </div>
                                    <Badge className="bg-orange-600 text-white font-bold border-none px-3">使用中</Badge>
                                </div>

                                <div className="flex items-end justify-between">
                                    <div className="space-y-1">
                                        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">目前剩餘額度</p>
                                        <p className="text-6xl font-bold tracking-tighter">
                                            {card.remainingQuota} <span className="text-lg opacity-30">/ {card.totalQuota} 堂</span>
                                        </p>
                                    </div>
                                    <div className="h-16 w-16 rounded-full border-4 border-muted flex items-center justify-center shrink-0">
                                        <span className="text-sm font-bold text-muted-foreground">
                                            {Math.round((card.remainingQuota / card.totalQuota) * 100)}%
                                        </span>
                                    </div>
                                </div>

                                <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-orange-600 transition-all duration-1000 ease-out"
                                        style={{ width: `${(card.remainingQuota / card.totalQuota) * 100}%` }}
                                    />
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-bold uppercase tracking-wider">
                                    <div className="flex items-center gap-4">
                                        <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 opacity-40" /> {card.purchaseDate} 購</span>
                                        <span className="h-3 w-[1px] bg-muted" />
                                        <span className="flex items-center gap-1.5 text-orange-600/80"><Clock className="h-3.5 w-3.5 opacity-40" /> 效期至 {card.expiryDate}</span>
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </TabsContent>

                <TabsContent value="pending" className="space-y-6">
                    {pendingCards.map((card) => (
                        <Card key={card.id} className="border-muted/60 bg-muted/5 rounded-3xl overflow-hidden p-8 space-y-6">
                            <div className="flex justify-between items-start gap-4">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/40">Pending Audit</p>
                                    <h2 className="text-xl font-bold tracking-tight opacity-60">{card.name}</h2>
                                </div>
                                <Badge variant="outline" className="border-orange-500/30 text-orange-600 bg-orange-50 font-bold shrink-0">
                                    財務審核中
                                </Badge>
                            </div>

                            <div className="flex items-center justify-between border-t border-muted/40 pt-6">
                                <div className="space-y-0.5">
                                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">應付總額</p>
                                    <p className="text-2xl font-bold">NT$ {card.price}</p>
                                </div>
                                <Button variant="outline" className="font-bold rounded-xl border-orange-500/20 hover:bg-orange-50 text-orange-600" asChild>
                                    <Link href={`/purchase/status/${card.id}`}>查看進度</Link>
                                </Button>
                            </div>
                        </Card>
                    ))}
                    {pendingCards.length === 0 && (
                        <div className="text-center py-20 bg-muted/5 rounded-3xl border border-dashed border-muted text-muted-foreground font-bold">
                            沒有待審核的項目
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="expired" className="space-y-4">
                    {expiredCards.map((card) => (
                        <div key={card.id} className="p-6 rounded-2xl border border-muted bg-muted/5 flex items-center justify-between opacity-50 grayscale">
                            <div className="space-y-1">
                                <h3 className="font-bold line-through">{card.name}</h3>
                                <div className="flex gap-4 text-[10px] font-bold text-muted-foreground uppercase">
                                    <span>{card.purchaseDate} 購</span>
                                    <span>{card.expiryDate} 止</span>
                                </div>
                            </div>
                            <Badge variant="secondary" className="font-bold">已失效</Badge>
                        </div>
                    ))}
                </TabsContent>
            </Tabs>
        </div>
    );
}
