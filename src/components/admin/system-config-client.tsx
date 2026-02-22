'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Save, ChevronLeft, Settings } from 'lucide-react';
import { updateSystemConfig } from '@/lib/supabase/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// Common config keys with labels and descriptions
const KNOWN_KEYS: Record<string, { label: string; description: string; type: 'text' | 'number' | 'boolean' | 'date' }> = {
    card_purchase_open: { label: '購卡功能開關', description: '控制學生是否可以於個人中心申請購買堂卡', type: 'boolean' },
    card_purchase_start: { label: '購卡開放日期', description: '開放申請購卡的起始日期 (YYYY-MM-DD)', type: 'date' },
    card_purchase_end: { label: '購卡截止日期', description: '申請購卡的最後截止日期 (YYYY-MM-DD)', type: 'date' },
    card_price_member: { label: '社員購卡單價', description: '具備有效社員身份者，購買堂卡的每張單價 (NT$)', type: 'number' },
    card_price_non_member: { label: '非社員購卡單價', description: '一般學員或會籍過期者，購買堂卡的每張單價 (NT$)', type: 'number' },
    card_min_purchase: { label: '最低購買張數', description: '單筆購卡申請的最少張數限制 (例如：5 張)', type: 'number' },
    card_expire_month: { label: '年度失效月份', description: '堂卡固定於每年年底何時失效 (通常設定為 12 月月底)', type: 'number' },
    bank_info: { label: '匯款帳號資訊', description: '公告於購卡頁面的指定匯款帳號、銀行代碼與戶名', type: 'text' },
};

interface ConfigEntry {
    key: string;
    value: string;
}

interface SystemConfigClientProps {
    initialConfig: ConfigEntry[];
}

export function SystemConfigClient({ initialConfig }: SystemConfigClientProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [entries, setEntries] = useState<ConfigEntry[]>(initialConfig);

    // Track original values for highlighting changes
    const originalMap = new Map(initialConfig.map(e => [e.key, e.value]));

    const updateEntry = (key: string, value: string) => {
        setEntries(prev => prev.map(e => e.key === key ? { ...e, value } : e));
    };

    const handleSave = () => {
        startTransition(async () => {
            try {
                const res = await updateSystemConfig(entries);
                if (res.success) {
                    toast.success(res.message);
                    router.refresh();
                }
            } catch (err: any) {
                toast.error(err.message || '儲存失敗');
            }
        });
    };

    // Define preferred order based on KNOWN_KEYS
    const knownKeyOrder = Object.keys(KNOWN_KEYS);
    const sortedEntries = [...entries].sort((a, b) => {
        const indexA = knownKeyOrder.indexOf(a.key);
        const indexB = knownKeyOrder.indexOf(b.key);

        if (indexA === -1 && indexB === -1) return a.key.localeCompare(b.key);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });

    const modifiedCount = entries.filter(e => originalMap.get(e.key) !== e.value).length;

    return (
        <div className="space-y-6">
            {/* Professional Header - Save Button at top right */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-2 border-b border-muted/30">
                <div className="flex items-center gap-1 -ml-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground">
                        <Link href="/dashboard"><ChevronLeft className="h-6 w-6" /></Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center text-black shrink-0 shadow-sm border border-muted/20">
                            <Settings className="h-5 w-5" />
                        </div>
                        <div className="space-y-0.5 select-none">
                            <h1 className="text-2xl font-bold tracking-tight leading-none text-foreground">系統參數管理</h1>
                            <p className="text-[13px] text-muted-foreground font-medium">配置系統全域參數與購卡視窗限定日期</p>
                        </div>
                    </div>
                </div>

                <Button
                    onClick={handleSave}
                    disabled={isPending || modifiedCount === 0}
                    className={cn(
                        "h-10 px-6 rounded-xl font-bold transition-all duration-300 shadow-sm",
                        modifiedCount > 0
                            ? "bg-primary hover:bg-primary/90 text-primary-foreground translate-y-0 scale-100"
                            : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
                    )}
                >
                    <Save className="h-4 w-4 mr-2" />
                    {isPending ? '儲存中' : `儲存變更 ${modifiedCount > 0 ? `(${modifiedCount})` : ''}`}
                </Button>
            </div>

            {/* Config Layout - Compact Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedEntries.map((entry) => {
                    const meta = KNOWN_KEYS[entry.key];
                    const isModified = originalMap.get(entry.key) !== entry.value;

                    return (
                        <Card key={entry.key} className={cn(
                            "border-muted/40 transition-all duration-200 shadow-none",
                            isModified ? "border-orange-500/30 bg-orange-500/[0.03] ring-1 ring-orange-500/10" : "bg-card hover:bg-muted/5"
                        )}>
                            <CardContent className="p-3.5 space-y-3">
                                <div className="flex items-start justify-between gap-2 min-h-[32px]">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[11px] font-black text-foreground uppercase tracking-wider">
                                                {meta?.label || entry.key}
                                            </span>
                                            {isModified && (
                                                <Badge variant="secondary" className="bg-orange-500 text-white px-1 h-3.5 text-[8px] font-black leading-none">MODIFIED</Badge>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-medium leading-tight line-clamp-1">
                                            {meta?.description || `Key: ${entry.key}`}
                                        </p>
                                    </div>

                                    {meta?.type === 'boolean' && (
                                        <Switch
                                            checked={entry.value === 'true'}
                                            onCheckedChange={(checked) => updateEntry(entry.key, String(checked))}
                                            className="scale-[0.85] data-[state=checked]:bg-green-600"
                                        />
                                    )}
                                </div>

                                {meta?.type !== 'boolean' && (
                                    <div className="relative">
                                        <Input
                                            type={meta?.type === 'number' ? 'number' : meta?.type === 'date' ? 'date' : 'text'}
                                            value={entry.value}
                                            onChange={(e) => updateEntry(entry.key, e.target.value)}
                                            className={cn(
                                                "h-8 text-xs font-bold px-2.5 bg-muted/20 border-muted/40 focus-visible:ring-orange-500/20",
                                                isModified && "border-orange-500/40 text-orange-600 bg-orange-500/[0.01]"
                                            )}
                                        />
                                        {meta?.type === 'number' && (
                                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-muted-foreground/40 pointer-events-none">VAL</span>
                                        )}
                                        {meta?.type === 'date' && (
                                            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[9px] font-black text-muted-foreground/40 pointer-events-none">DATE</span>
                                        )}
                                    </div>
                                )}

                                {meta?.type === 'boolean' && (
                                    <div className="flex items-center gap-1.5 text-[9px] font-black">
                                        <div className={cn("h-1.5 w-1.5 rounded-full", entry.value === 'true' ? "bg-green-500" : "bg-muted-foreground/30")} />
                                        <span className={entry.value === 'true' ? "text-green-600" : "text-muted-foreground"}>
                                            {entry.value === 'true' ? 'SYSTEM OPEN' : 'SYSTEM CLOSED'}
                                        </span>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Notice Footer */}
            <p className="text-[10px] text-muted-foreground text-center font-medium pt-4 opacity-60">
                註：本頁面不允許新增或刪除參數。如需調整資料庫結構，請聯繫開發人員。
            </p>
        </div>
    );
}
