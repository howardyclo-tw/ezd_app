'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronLeft, ChevronRight, Music, User, CreditCard, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { submitGroupEnrollment as _submitGroupEnrollment } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
import { toast } from 'sonner';
import type { PerCourseResult } from '@/lib/supabase/actions';

const submitGroupEnrollment = safe(_submitGroupEnrollment);

interface PollOption {
    id: string;
    label: string;
    youtubeUrl: string | null;
}

interface CoursePoll {
    id: string;
    title: string;
    voteType: string;
    options: PollOption[];
}

export interface WizardCourse {
    id: string;
    name: string;
    teacher: string;
    room: string;
    type: string;
    capacity: number;
    occupancy: number;
    sessionsCount: number;
    cardsPerSession: number;
    pricingMode: string;
    priceMemberFull: number | null;
    priceGuestFull: number | null;
    enrollFull: boolean;
    isFull: boolean;
    isEnrolled: boolean;
    isMv: boolean;
    pricingBadge: string;
    canEnrollFull: boolean;
    identityLocked?: boolean;
    startTime: string;
    endTime: string;
    firstSessionDate: string;
    poll: CoursePoll | null;
}

interface RegisterWizardClientProps {
    groupId: string;
    groupTitle: string;
    courses: WizardCourse[];
    cardBalance: number;
    userRole: string;
    groupSlug: string;
}

type Step = 'select' | 'mv' | 'leader' | 'payment' | 'done';

const PRICING_BADGE_COLORS: Record<string, string> = {
    '堂卡': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'NTD': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    '免費': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

export function RegisterWizardClient({
    groupId,
    groupTitle,
    courses,
    cardBalance,
    userRole,
    groupSlug,
}: RegisterWizardClientProps) {
    const router = useRouter();
    const [step, setStep] = useState<Step>('select');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [wantsLeader, setWantsLeader] = useState<Record<string, boolean>>({});
    const [buyCardsQty, setBuyCardsQty] = useState<number>(0);
    const [includeMembership, setIncludeMembership] = useState(false);
    const [remittanceBank, setRemittanceBank] = useState('');
    const [remittanceLast5, setRemittanceLast5] = useState('');
    const [remittanceDate, setRemittanceDate] = useState('');
    const [isPending, startTransition] = useTransition();
    const [results, setResults] = useState<PerCourseResult[]>([]);

    const selectedCourses = courses.filter(c => selectedIds.has(c.id));
    const mvCourses = selectedCourses.filter(c => c.isMv);
    const hasMvCourses = mvCourses.length > 0;

    // Compute costs
    const totalCards = selectedCourses
        .filter(c => c.pricingMode === 'card' && !c.isMv)
        .reduce((sum, c) => sum + c.cardsPerSession * c.sessionsCount, 0);
    const totalNtd = selectedCourses
        .filter(c => c.pricingMode === 'ntd')
        .reduce((sum, c) => sum + (c.priceMemberFull ?? c.priceGuestFull ?? 0), 0);
    const cardShortfall = Math.max(0, totalCards - cardBalance);
    const hasShortfall = cardShortfall > 0;

    const toggleCourse = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const getSteps = (): Step[] => {
        const steps: Step[] = ['select'];
        if (hasMvCourses) steps.push('mv');
        steps.push('leader', 'payment', 'done');
        return steps;
    };

    const stepIndex = getSteps().indexOf(step);

    const goNext = () => {
        const steps = getSteps();
        const idx = steps.indexOf(step);
        if (idx < steps.length - 1) setStep(steps[idx + 1]);
    };

    const goPrev = () => {
        const steps = getSteps();
        const idx = steps.indexOf(step);
        if (idx > 0) setStep(steps[idx - 1]);
    };

    const handleSubmit = () => {
        if (selectedIds.size === 0) return;

        startTransition(async () => {
            try {
                const selections = selectedCourses.map(c => ({
                    courseId: c.id,
                    mode: 'full' as const,
                    wantsLeader: wantsLeader[c.id] ?? false,
                }));

                const buyCards = hasShortfall && buyCardsQty > 0
                    ? {
                        quantity: buyCardsQty,
                        ...(remittanceBank && remittanceLast5 && remittanceDate
                            ? {
                                remittance: {
                                    bankCode: remittanceBank,
                                    last5: remittanceLast5,
                                    remittanceDate: remittanceDate,
                                },
                            }
                            : {}),
                    }
                    : undefined;

                const res = await submitGroupEnrollment({
                    groupId,
                    selections,
                    buyCards,
                    includeMembership: includeMembership || undefined,
                });

                if (res && 'perCourse' in res) {
                    setResults(res.perCourse);
                    setStep('done');
                } else if (res && 'message' in res) {
                    toast.error((res as { message: string }).message);
                }
            } catch (err) {
                toast.error(err instanceof Error ? err.message : '報名失敗');
            }
        });
    };

    const statusLabels: Record<string, { label: string; color: string }> = {
        enrolled: { label: '報名成功', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
        pending_payment: { label: '待繳費', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
        pending_vote: { label: '待選歌', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
        full: { label: '額滿', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
        rejected: { label: '失敗', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
    };

    return (
        <div className="container max-w-2xl py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-9 w-9 shrink-0"
                    onClick={() => router.push(`/courses/groups/${groupSlug}`)}
                    aria-label="返回"
                >
                    <ChevronLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-xl font-bold tracking-tight">整期報名</h1>
                    <p className="text-sm text-muted-foreground">{groupTitle}</p>
                </div>
            </div>

            {/* Progress */}
            {step !== 'done' && (
                <div className="flex items-center gap-2 px-1">
                    {getSteps().filter(s => s !== 'done').map((s, i) => (
                        <div
                            key={s}
                            className={cn(
                                'h-1.5 flex-1 rounded-full transition-colors',
                                i <= stepIndex ? 'bg-primary' : 'bg-muted'
                            )}
                        />
                    ))}
                </div>
            )}

            {/* Step: Select Courses */}
            {step === 'select' && (
                <div className="space-y-4" data-testid="step-select">
                    <h2 className="text-lg font-bold">選課</h2>
                    <p className="text-sm text-muted-foreground">
                        選擇您要報名的課程
                    </p>

                    {courses.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground text-sm border-2 border-dashed rounded-xl">
                            此檔期尚無課程
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {courses.map(course => {
                                const isDisabled = course.isFull || course.isEnrolled || !course.canEnrollFull;
                                const isSelected = selectedIds.has(course.id);
                                let disabledReason = '';
                                if (course.isEnrolled) disabledReason = '已報名';
                                else if (course.isFull) disabledReason = '額滿';
                                else if (course.identityLocked) disabledReason = '此課程僅開放社員報名';
                                else if (!course.canEnrollFull) disabledReason = '未開放整期報名';

                                return (
                                    <div
                                        key={course.id}
                                        onClick={() => !isDisabled && toggleCourse(course.id)}
                                        className={cn(
                                            'flex items-center gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer',
                                            isDisabled
                                                ? 'opacity-50 cursor-not-allowed bg-muted/10 border-muted'
                                                : isSelected
                                                    ? 'bg-primary/[0.03] border-primary'
                                                    : 'bg-muted/5 border-transparent hover:border-primary/20'
                                        )}
                                        data-testid={`course-option-${course.id}`}
                                    >
                                        {!isDisabled && (
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => toggleCourse(course.id)}
                                                className="h-5 w-5 shrink-0"
                                                onClick={e => e.stopPropagation()}
                                                aria-label={`選擇 ${course.name}`}
                                            />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-sm truncate">
                                                    {course.teacher} {course.name}
                                                </span>
                                                <Badge
                                                    variant="secondary"
                                                    className={cn('text-[10px] font-bold px-1.5 py-0',
                                                        PRICING_BADGE_COLORS[course.pricingBadge] ?? ''
                                                    )}
                                                >
                                                    {course.pricingBadge}
                                                </Badge>
                                                {course.isMv && (
                                                    <Badge variant="secondary" className="text-[10px] font-bold px-1.5 py-0 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                                        MV
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                <span>{course.sessionsCount} 堂</span>
                                                <span>|</span>
                                                <span>{course.occupancy}/{course.capacity} 人</span>
                                                {course.pricingMode === 'card' && (
                                                    <>
                                                        <span>|</span>
                                                        <span>{course.cardsPerSession * course.sessionsCount} 堂卡</span>
                                                    </>
                                                )}
                                                {course.pricingMode === 'ntd' && course.priceMemberFull != null && (
                                                    <>
                                                        <span>|</span>
                                                        <span>${course.priceMemberFull}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {disabledReason && (
                                            <Badge variant="secondary" className="text-[10px] shrink-0">
                                                {disabledReason}
                                            </Badge>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex justify-end pt-4">
                        <Button
                            onClick={goNext}
                            disabled={selectedIds.size === 0}
                            className="gap-2"
                        >
                            下一步 <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Step: MV Song Selection (read-only for now) */}
            {step === 'mv' && (
                <div className="space-y-4" data-testid="step-mv">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Music className="h-5 w-5" /> MV 選歌
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        以下 MV 課程有開放投票（投票功能即將開放）
                    </p>

                    {mvCourses.map(course => (
                        <div key={course.id} className="border rounded-xl p-4 space-y-3">
                            <h3 className="font-bold text-sm">{course.teacher} {course.name}</h3>
                            {course.poll && (
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground font-medium">{course.poll.title}</p>
                                    {course.poll.options.map(opt => (
                                        <div key={opt.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/10">
                                            <span className="text-sm">{opt.label}</span>
                                            {opt.youtubeUrl && (
                                                <Badge variant="outline" className="text-[10px]">
                                                    YT
                                                </Badge>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}

                    <div className="flex justify-between pt-4">
                        <Button variant="outline" onClick={goPrev} className="gap-2">
                            <ChevronLeft className="h-4 w-4" /> 上一步
                        </Button>
                        <Button onClick={goNext} className="gap-2">
                            下一步 <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Step: Leader Preference */}
            {step === 'leader' && (
                <div className="space-y-4" data-testid="step-leader">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <User className="h-5 w-5" /> 班長意願
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        如有意願擔任班長，請開啟對應課程的開關
                    </p>

                    {selectedCourses.map(course => (
                        <div key={course.id} className="flex items-center justify-between p-4 border rounded-xl">
                            <span className="font-medium text-sm">{course.teacher} {course.name}</span>
                            <div className="flex items-center gap-2">
                                <Label htmlFor={`leader-${course.id}`} className="text-xs text-muted-foreground">
                                    想當班長
                                </Label>
                                <Switch
                                    id={`leader-${course.id}`}
                                    checked={wantsLeader[course.id] ?? false}
                                    onCheckedChange={(checked) =>
                                        setWantsLeader(prev => ({ ...prev, [course.id]: checked }))
                                    }
                                    aria-label={`${course.name} 想當班長`}
                                />
                            </div>
                        </div>
                    ))}

                    <div className="flex justify-between pt-4">
                        <Button variant="outline" onClick={goPrev} className="gap-2">
                            <ChevronLeft className="h-4 w-4" /> 上一步
                        </Button>
                        <Button onClick={goNext} className="gap-2">
                            下一步 <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Step: Payment Summary */}
            {step === 'payment' && (
                <div className="space-y-4" data-testid="step-payment">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <CreditCard className="h-5 w-5" /> 費用結算
                    </h2>

                    {/* Card summary */}
                    {totalCards > 0 && (
                        <div className="border rounded-xl p-4 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>堂卡扣除</span>
                                <span className="font-bold">{totalCards} 堂卡</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>目前餘額</span>
                                <span className={cn('font-bold', hasShortfall ? 'text-destructive' : '')}>
                                    {cardBalance} 堂卡
                                </span>
                            </div>
                            {hasShortfall && (
                                <div className="text-sm text-destructive font-medium">
                                    不足 {cardShortfall} 堂卡
                                </div>
                            )}
                        </div>
                    )}

                    {/* NTD summary */}
                    {totalNtd > 0 && (
                        <div className="border rounded-xl p-4">
                            <div className="flex justify-between text-sm">
                                <span>課程費用</span>
                                <span className="font-bold">${totalNtd}</span>
                            </div>
                        </div>
                    )}

                    {/* Buy cards option */}
                    {hasShortfall && (
                        <div className="border rounded-xl p-4 space-y-3">
                            <h3 className="text-sm font-bold">加購堂卡</h3>
                            <div className="flex items-center gap-3">
                                <Label htmlFor="buy-qty" className="text-sm shrink-0">數量</Label>
                                <Input
                                    id="buy-qty"
                                    type="number"
                                    min={cardShortfall}
                                    step={5}
                                    value={buyCardsQty || ''}
                                    onChange={e => setBuyCardsQty(parseInt(e.target.value) || 0)}
                                    className="w-24"
                                    placeholder={String(cardShortfall)}
                                />
                            </div>

                            {buyCardsQty > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                        <Label htmlFor="bank-code" className="text-sm shrink-0">銀行代碼</Label>
                                        <Input
                                            id="bank-code"
                                            value={remittanceBank}
                                            onChange={e => setRemittanceBank(e.target.value)}
                                            className="w-24"
                                            placeholder="012"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Label htmlFor="last5" className="text-sm shrink-0">帳號末五碼</Label>
                                        <Input
                                            id="last5"
                                            value={remittanceLast5}
                                            onChange={e => setRemittanceLast5(e.target.value)}
                                            className="w-32"
                                            placeholder="12345"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Label htmlFor="remit-date" className="text-sm shrink-0">匯款日期</Label>
                                        <Input
                                            id="remit-date"
                                            type="date"
                                            value={remittanceDate}
                                            onChange={e => setRemittanceDate(e.target.value)}
                                            className="w-40"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Membership add-on */}
                    {userRole !== 'admin' && (
                        <div className="flex items-center justify-between border rounded-xl p-4">
                            <div>
                                <span className="text-sm font-medium">加購社員資格</span>
                                <p className="text-xs text-muted-foreground">$1,800</p>
                            </div>
                            <Switch
                                checked={includeMembership}
                                onCheckedChange={setIncludeMembership}
                                aria-label="加購社員資格"
                            />
                        </div>
                    )}

                    <div className="flex justify-between pt-4">
                        <Button variant="outline" onClick={goPrev} className="gap-2">
                            <ChevronLeft className="h-4 w-4" /> 上一步
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={isPending || (hasShortfall && buyCardsQty < cardShortfall)}
                            className="gap-2"
                        >
                            {isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Check className="h-4 w-4" />
                            )}
                            確認報名
                        </Button>
                    </div>
                </div>
            )}

            {/* Step: Done */}
            {step === 'done' && (
                <div className="space-y-4" data-testid="step-done">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Check className="h-5 w-5" /> 完成
                    </h2>

                    <div className="space-y-3">
                        {results.map(r => {
                            const course = courses.find(c => c.id === r.courseId);
                            const info = statusLabels[r.status] ?? { label: r.status, color: 'bg-muted' };
                            return (
                                <div key={r.courseId} className="flex items-center justify-between p-4 border rounded-xl">
                                    <span className="text-sm font-medium">
                                        {course ? `${course.teacher} ${course.name}` : r.courseId}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <Badge className={cn('text-[10px] font-bold', info.color)}>
                                            {info.label}
                                        </Badge>
                                        {r.reason && (
                                            <span className="text-xs text-muted-foreground">{r.reason}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex justify-center pt-4">
                        <Button
                            onClick={() => router.push(`/courses/groups/${groupSlug}`)}
                            className="gap-2"
                        >
                            返回課程列表
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
