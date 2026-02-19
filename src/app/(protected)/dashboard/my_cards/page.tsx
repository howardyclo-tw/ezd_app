import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Clock, CalendarDays, ChevronLeft, Plus } from 'lucide-react';
import Link from 'next/link';

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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Left-aligned Header with Back Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0">
                        <Link href="/dashboard">
                            <ChevronLeft className="h-6 w-6" />
                        </Link>
                    </Button>
                    <div className="space-y-0.5 select-none">
                        <h1 className="text-2xl font-bold tracking-tight leading-none text-orange-600">我的堂卡</h1>
                        <p className="text-[13px] text-muted-foreground font-medium">
                            管理餘額、購卡與紀錄
                        </p>
                    </div>
                </div>

                <Button size="sm" className="h-10 text-sm font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-md transition-all active:scale-95 px-6 w-full sm:w-auto" asChild>
                    <Link href="/topup">
                        <Plus className="h-4 w-4 mr-2" /> 立即購卡
                    </Link>
                </Button>
            </div>

            {/* Filter Tabs */}
            <div className="flex justify-center px-4 sm:px-0">
                <Tabs defaultValue="active" className="w-full sm:w-auto">
                    <TabsList className="bg-muted/50 p-1 h-9 border border-muted-foreground/10 w-full grid grid-cols-3 sm:flex sm:grid-cols-none sm:w-auto">
                        <TabsTrigger value="pending" className="text-[12px] sm:text-sm font-medium data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all gap-2 px-4 shadow-sm">
                            未開通
                            {pendingCards.length > 0 && (
                                <span className="bg-white/20 px-1.5 py-0.5 text-[10px] rounded-full">
                                    {pendingCards.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="active" className="text-[12px] sm:text-sm font-medium data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all px-4 shadow-sm">使用中</TabsTrigger>
                        <TabsTrigger value="expired" className="text-[12px] sm:text-sm font-medium data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all px-4 shadow-sm">歷史/失效</TabsTrigger>
                    </TabsList>

                    <div className="mt-8 space-y-6">
                        <TabsContent value="active" className="space-y-6 m-0 border-none p-0 outline-none">
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
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/60">Active Pass</p>
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

                        <TabsContent value="pending" className="space-y-6 m-0 border-none p-0 outline-none">
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

                        <TabsContent value="expired" className="space-y-4 m-0 border-none p-0 outline-none">
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
                    </div>
                </Tabs>
            </div>
        </div>
    );
}
