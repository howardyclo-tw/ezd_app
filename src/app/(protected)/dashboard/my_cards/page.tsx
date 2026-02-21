import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Clock, CalendarDays, ChevronLeft, Plus } from 'lucide-react';
import Link from 'next/link';

export default async function MyCardsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/login');

    // Fetch user profile for balance
    const { data: profile } = await supabase
        .from('profiles')
        .select('name, card_balance')
        .eq('id', user.id)
        .maybeSingle();

    // Fetch card orders
    const { data: orders } = await supabase
        .from('card_orders')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

    const activeCards = (orders ?? []).filter(o => o.status === 'confirmed');
    const pendingCards = (orders ?? []).filter(o => o.status === 'pending' || o.status === 'remitted');
    const expiredCards = (orders ?? []).filter(o => o.status === 'cancelled');

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
                        <TabsTrigger value="expired" className="text-[12px] sm:text-sm font-medium data-[state=active]:bg-orange-600 data-[state=active]:text-white transition-all px-4 shadow-sm">歷史/已取消</TabsTrigger>
                    </TabsList>

                    <div className="mt-8 space-y-6">
                        <TabsContent value="active" className="space-y-6 m-0 border-none p-0 outline-none">
                            {activeCards.length === 0 ? (
                                <div className="text-center py-24 bg-muted/10 rounded-3xl border border-dashed border-muted">
                                    <CreditCard className="h-10 w-10 mx-auto mb-4 opacity-10" />
                                    <p className="text-muted-foreground font-bold">目前沒有可用的堂卡</p>
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Overall Balance Summary Card */}
                                    <Card className="bg-card border border-muted/60 shadow-sm rounded-3xl p-8 space-y-8 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-8 opacity-5">
                                            <CreditCard className="h-32 w-32 -rotate-12 translate-x-8 translate-y-8 text-foreground" />
                                        </div>
                                        <div className="space-y-1 relative">
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Total Running Balance</p>
                                            <h2 className="text-2xl font-black">目前的總剩餘堂數</h2>
                                        </div>

                                        <div className="flex items-end justify-between relative">
                                            <div className="space-y-1">
                                                <p className="text-7xl font-black tracking-tighter">
                                                    {profile?.card_balance ?? 0} <span className="text-xl opacity-40 font-bold ml-1">堂卡</span>
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground relative">
                                            <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> 系統即時更新</span>
                                        </div>
                                    </Card>

                                    {/* List of Confirmed Orders */}
                                    {activeCards.map((card) => (
                                        <Card key={card.id} className="border-muted/60 bg-muted/5 shadow-sm overflow-hidden relative group hover:border-orange-600/30 transition-all rounded-3xl p-6 flex flex-row items-center justify-between gap-4">
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600/60">Purchase ID: {card.id.slice(0, 8)}</p>
                                                <h3 className="text-base font-bold">已開通: {card.quantity} 堂課卡</h3>
                                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                                    購於 {card.remittance_date || card.created_at.slice(0, 10)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <Badge variant="outline" className="border-orange-500/30 text-orange-600 bg-orange-500/5 font-bold mb-1">已生效</Badge>
                                                <p className="text-xs text-muted-foreground font-bold">NT$ {card.total_amount}</p>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
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
