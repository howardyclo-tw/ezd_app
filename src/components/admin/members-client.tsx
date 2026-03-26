'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Search, Users, Crown, Shield, User, Calendar, ChevronDown, Info, KeyRound } from 'lucide-react';
import { updateMemberProfile, resetMemberPassword } from '@/lib/supabase/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MemberData {
    id: string;
    name: string;
    employee_id: string | null;
    role: string;
    member_valid_until: string | null;
    card_balance: number;
    makeup_quota: number; // Final available count
    makeup_base: number;  // sum(ceil(n/4))
    makeup_used: number;  // makeup + transfer used
    makeup_adj: number;   // manual adjustment from DB
    makeup_base_details: string[]; // ['Jazz(4)', 'Popping(2)']
    leader_courses: { courseName: string; groupTitle: string }[];
    enrollments: {
        courseId: string;
        courseName: string;
        groupTitle: string;
        sessions: {
            id: string;
            date: string;
            source: string;
        }[]
    }[];
}

interface MembersClientProps {
    members: MemberData[];
}

const ROLE_OPTIONS = [
    { value: 'guest', label: '非社員', color: 'text-muted-foreground border-muted' },
    { value: 'member', label: '社員', color: 'text-blue-600 border-blue-500/30 bg-blue-500/5' },
    { value: 'admin', label: '幹部', color: 'text-purple-600 border-purple-500/30 bg-purple-500/5' },
];

function getRoleInfo(role: string) {
    return ROLE_OPTIONS.find(r => r.value === role) || ROLE_OPTIONS[0];
}

function getRoleIcon(role: string) {
    switch (role) {
        case 'admin': return <Shield className="h-3 w-3" />;
        case 'member': return <Users className="h-3 w-3" />;
        default: return <User className="h-3 w-3" />;
    }
}

function ResetPasswordButton({ memberId }: { memberId?: string }) {
    const [confirming, setConfirming] = useState(false);
    const [resetting, setResetting] = useState(false);

    // Reset confirm state when dialog member changes
    const handleReset = async () => {
        if (!memberId) return;
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setResetting(true);
        try {
            const result = await resetMemberPassword(memberId);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err: any) {
            toast.error(err.message);
        } finally {
            setResetting(false);
            setConfirming(false);
        }
    };

    return (
        <div className="px-6 pb-4 flex gap-2">
            <Button
                variant="outline"
                className={cn(
                    "flex-1 h-9 rounded-xl text-xs font-bold transition-all",
                    confirming
                        ? "text-rose-600 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 hover:text-rose-600"
                        : "text-amber-600 border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:text-amber-600"
                )}
                onClick={handleReset}
                disabled={resetting}
            >
                <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                {resetting ? '重置中...' : confirming ? '確認重置密碼？' : '重置密碼為預設 (mediatek)'}
            </Button>
            {confirming && (
                <Button
                    variant="ghost"
                    className="h-9 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground"
                    onClick={() => setConfirming(false)}
                >
                    取消
                </Button>
            )}
        </div>
    );
}

export function MembersClient({ members }: MembersClientProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [editMember, setEditMember] = useState<MemberData | null>(null);
    const [editRole, setEditRole] = useState('');
    const [editValidUntil, setEditValidUntil] = useState('');
    const [editCardBalance, setEditCardBalance] = useState<string>('0');
    const [editMakeupAdj, setEditMakeupAdj] = useState<number>(0);
    const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

    // Filter members
    const filtered = members.filter(m => {
        const matchesSearch = searchQuery === '' ||
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (m.employee_id && m.employee_id.toLowerCase().includes(searchQuery.toLowerCase()));
        const matchesRole = roleFilter === 'all' || m.role === roleFilter;
        return matchesSearch && matchesRole;
    });

    // Role stats
    const roleCounts = {
        all: members.length,
        admin: members.filter(m => m.role === 'admin').length,
        member: members.filter(m => m.role === 'member').length,
        guest: members.filter(m => m.role === 'guest').length,
    };

    const openEdit = (member: MemberData) => {
        setEditMember(member);
        setEditRole(member.role);
        setEditValidUntil(member.member_valid_until || '');
        setEditCardBalance(String(member.card_balance));
        // Start with the CURRENT TOTAL as the initial value for the direct override
        setEditMakeupAdj(member.makeup_quota);
        setExpandedCourse(null);
    };

    const handleSave = () => {
        if (!editMember) return;
        
        // Calculate the system-determined baseline (total - current adjustment)
        const systemBaseline = editMember.makeup_quota - editMember.makeup_adj;
        // The new adjustment should be: RequestedTotal - SystemBaseline
        const newAdj = editMakeupAdj - systemBaseline;

        startTransition(async () => {
            try {
                await updateMemberProfile(editMember.id, {
                    role: editRole,
                    member_valid_until: editValidUntil || null,
                    card_balance: parseInt(editCardBalance) || 0,
                    makeup_quota: newAdj, // We save the offset, but user saw/edited the TOTAL
                });
                toast.success('社員資料已更新');
                setEditMember(null);
                setEditMakeupAdj(0); 
                router.refresh();
            } catch (err: any) {
                toast.error(err.message || '更新失敗');
            }
        });
    };

    const deleteSessionEnrollment = async (enrollmentId: string, date: string, source: string) => {
        if (!editMember) return;

        const isSpecial = source === 'transfer' || source === 'makeup' || source === 'card_purchase';
        const warning = isSpecial
            ? `\n\n🚨 注意：此堂課的報名來源為「${source}」。取消後不會自動返還點數給原主，如需退還請手動調整「補課點數」或原主的點數。`
            : '';

        const message = `⚠️ 安全保護確認：\n\n確定取消此堂 (${date}) 的報名嗎？\n\n1. 此操作將連同「點名、請假」紀錄一併移除。${warning}\n\n確定要執行嗎？`;

        if (!confirm(message)) return;

        toast.info('單堂取消功能開發中。');
    };

    return (
        <>
            {/* Stats Pills */}
            <div className="flex flex-wrap gap-2">
                {(['all', 'admin', 'member', 'guest'] as const).map(r => (
                    <button
                        key={r}
                        onClick={() => setRoleFilter(r)}
                        className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                            roleFilter === r
                                ? "bg-foreground text-background border-foreground"
                                : "bg-muted/30 text-muted-foreground border-muted hover:bg-muted/50"
                        )}
                    >
                        {r === 'all' ? '全部' : getRoleInfo(r).label} ({roleCounts[r]})
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="搜尋姓名或工號..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-11 bg-muted/20 border-muted/40 font-bold"
                />
            </div>

            {/* Member List */}
            <div className="space-y-2">
                {filtered.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground font-bold">
                        沒有符合條件的成員
                    </div>
                ) : (
                    filtered.map(member => {
                        const roleInfo = getRoleInfo(member.role);
                        const today = new Date().toLocaleDateString('sv-SE');
                        const isExpired = member.member_valid_until &&
                            member.member_valid_until < today;

                        return (
                            <Card
                                key={member.id}
                                className="border-muted/40 bg-card hover:bg-muted/10 transition-colors group cursor-pointer active:scale-[0.98]"
                                onClick={() => openEdit(member)}
                            >
                                <CardContent className="p-3 px-4 flex items-center gap-4">
                                    <div className={cn(
                                        "h-9 w-9 rounded-full flex items-center justify-center shrink-0 border bg-muted/5",
                                        roleInfo.color
                                    )}>
                                        {getRoleIcon(member.role)}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold text-sm tracking-tight">{member.name}</span>
                                            <Badge variant="outline" className={cn("text-[9px] font-black h-4.5 px-1.5 uppercase tracking-tighter", roleInfo.color)}>
                                                {roleInfo.label}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground mt-0.5 font-medium flex-wrap">
                                            {member.employee_id && <span>{member.employee_id}</span>}
                                            {member.member_valid_until && (
                                                <span className={cn(
                                                    "flex items-center gap-1 font-bold",
                                                    isExpired ? "text-rose-500" : "text-muted-foreground"
                                                )}>
                                                    <Calendar className="h-3 w-3 text-muted-foreground/60" />
                                                    {isExpired ? '已到期' : '效期'} {member.member_valid_until}
                                                </span>
                                            )}
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <div className={cn(
                                                    "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-black tracking-tighter transition-colors",
                                                    member.card_balance > 0 
                                                        ? "bg-orange-500/5 border-orange-500/20 text-orange-600" 
                                                        : "bg-muted/30 border-muted/50 text-muted-foreground/60"
                                                )}>
                                                    <span className="opacity-70">堂卡</span>
                                                    <span>{member.card_balance}</span>
                                                </div>
                                                <div className={cn(
                                                    "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-black tracking-tighter transition-colors",
                                                    member.makeup_quota > 0 
                                                        ? "bg-[#FF6B00]/5 border-[#FF6B00]/20 text-[#FF6B00]" 
                                                        : "bg-muted/30 border-muted/50 text-muted-foreground/60"
                                                )}>
                                                    <span className="opacity-70">補課</span>
                                                    <span>{member.makeup_quota}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>

            {/* Edit Dialog */}
            <Dialog open={!!editMember} onOpenChange={(open) => !open && setEditMember(null)}>
                <DialogContent className="sm:max-w-[440px] max-h-[95vh] overflow-y-auto p-0 gap-0 border-none shadow-2xl rounded-3xl group/dialog">
                    {/* The (x) close button is provided by Shadcn Dialog by default, but it disappears if DialogContent has custom bg/border. 
                        We don't need to manually add it unless we want to move it inside our p-6. */}
                    
                    <div className="p-6 pb-4">
                        <DialogHeader>
                            <DialogTitle className="text-xl font-black tracking-tighter">成員帳號管理</DialogTitle>
                            <DialogDescription className="font-bold text-muted-foreground text-xs uppercase tracking-widest mt-1">
                                {editMember?.name} {editMember?.employee_id && <span className="ml-2 bg-muted px-2 py-0.5 rounded text-[10px]">ID: {editMember.employee_id}</span>}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div className="px-6 space-y-6 pb-8">
                        {/* Status Section */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest ml-1">身份等級</label>
                                <Select value={editRole} onValueChange={setEditRole}>
                                    <SelectTrigger className="h-10 bg-muted/30 border-muted/40 text-sm font-bold rounded-xl focus:ring-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl border-muted/40 font-bold">
                                        {ROLE_OPTIONS.map(r => (
                                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest ml-1">帳號效期</label>
                                <Input
                                    type="date"
                                    value={editValidUntil}
                                    onChange={(e) => setEditValidUntil(e.target.value)}
                                    className="h-10 bg-muted/30 border-muted/40 text-sm font-bold rounded-xl focus-visible:ring-0"
                                />
                            </div>
                        </div>

                        {/* Credits Section */}
                        <div className="grid grid-cols-2 gap-3 p-3 bg-muted/10 rounded-2xl border border-muted/20">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest ml-1">堂卡點數</label>
                                <Input
                                    type="number"
                                    value={editCardBalance}
                                    onChange={(e) => setEditCardBalance(e.target.value)}
                                    min={0}
                                    className="h-10 bg-background border-muted/40 text-sm font-black rounded-xl focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    inputMode="numeric"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-[#FF6B00]/70 tracking-widest ml-1">總補課額度 (手動直接修改)</label>
                                <Input
                                    type="number"
                                    value={editMakeupAdj === 0 ? '' : editMakeupAdj}
                                    onChange={(e) => setEditMakeupAdj(e.target.value === '' ? 0 : parseInt(e.target.value))}
                                    className="h-10 bg-background border-[#FF6B00]/30 text-sm font-black text-[#FF6B00] rounded-xl focus-visible:ring-0 placeholder:text-[#FF6B00]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    placeholder="0"
                                    inputMode="numeric"
                                />
                            </div>
                        </div>

                        {/* Makeup Quota Explorer */}
                        {editMember && (
                            <div className="p-4 bg-[#FF6B00]/5 border border-[#FF6B00]/10 rounded-2xl space-y-3">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-[#FF6B00]/70 ml-1">
                                    <span>補課額度計算解析 (系統自動 + 手動修正)</span>
                                    <Info className="h-3.5 w-3.5" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 bg-white/40 dark:bg-black/20 rounded-xl border border-border/50 shadow-sm backdrop-blur-sm">
                                        <span className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-tight block mb-1">系統判定 (未調整前)</span>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-xl font-black text-foreground/80">{editMember.makeup_quota - editMember.makeup_adj}</span>
                                            <span className="text-[10px] font-bold text-muted-foreground/60">堂</span>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-[#FF6B00]/10 rounded-xl border border-[#FF6B00]/20 shadow-sm">
                                        <span className="text-[10px] font-bold text-[#FF6B00]/70 uppercase tracking-tight block mb-1">最終總計 (可用)</span>
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-xl font-black text-[#FF6B00]">{editMakeupAdj}</span>
                                            <span className="text-[10px] font-bold text-[#FF6B00]/70">堂</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between px-1">
                                    <span className="text-[10px] font-black text-muted-foreground/50 uppercase tracking-tight">手動修正預覽</span>
                                    <Badge variant="outline" className={cn(
                                        "text-[10px] font-black px-2 h-5 border-none",
                                        (editMakeupAdj - (editMember.makeup_quota - editMember.makeup_adj)) >= 0 
                                            ? "bg-blue-500/10 text-blue-600" 
                                            : "bg-rose-500/10 text-rose-500"
                                    )}>
                                        {(editMakeupAdj - (editMember.makeup_quota - editMember.makeup_adj)) > 0 ? `+${editMakeupAdj - (editMember.makeup_quota - editMember.makeup_adj)}` : (editMakeupAdj - (editMember.makeup_quota - editMember.makeup_adj))} 堂
                                    </Badge>
                                </div>

                                {(editMember.makeup_base_details || []).length > 0 && (
                                    <div className="px-1 mt-1">
                                        <div className="text-[10px] font-bold text-muted-foreground/80 flex flex-wrap gap-x-2 gap-y-1 justify-center">
                                            實際點數來源：
                                            {editMember.makeup_base_details.map((detail, idx) => (
                                                <span key={idx} className="bg-muted/10 px-1.5 py-0.5 rounded border border-muted/20 whitespace-nowrap">
                                                    {detail}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <p className="text-[9px] text-orange-500/50 font-medium italic text-center px-2 leading-relaxed">
                                    * 基礎規則: 常態/特殊常態課整期加總，每 4 堂提供 1 堂補課額度 (無條件進位)
                                </p>
                            </div>
                        )}

                        {/* Enrollments Accordion */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest ml-1 flex items-center justify-between">
                                已報名課程列表
                                <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[9px]">{editMember?.enrollments.length || 0} 個課程</span>
                            </label>

                            {editMember?.enrollments.length === 0 ? (
                                <div className="p-8 text-center bg-muted/10 rounded-2xl border border-dashed border-muted/40">
                                    <p className="text-xs text-muted-foreground font-bold italic">目前查無報名紀錄</p>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 scrollbar-hide">
                                    {editMember?.enrollments.map((en, i) => {
                                        const isExpanded = expandedCourse === en.courseId;
                                        return (
                                            <div key={i} className={cn(
                                                "border transition-all duration-200 rounded-2xl overflow-hidden",
                                                isExpanded ? "border-primary/30 bg-primary/5 shadow-sm" : "border-muted/30 bg-muted/10"
                                            )}>
                                                <div
                                                    className="flex items-center justify-between p-3 cursor-pointer group"
                                                    onClick={() => setExpandedCourse(isExpanded ? null : en.courseId)}
                                                >
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-[9px] text-muted-foreground font-black uppercase tracking-tighter">{en.groupTitle}</span>
                                                        <span className="text-xs font-black text-foreground truncate">{en.courseName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="secondary" className="bg-background text-[10px] font-black rounded-lg h-5 px-1.5">
                                                            {en.sessions.length} 堂
                                                        </Badge>
                                                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", isExpanded && "rotate-180")} />
                                                    </div>
                                                </div>

                                                {isExpanded && (
                                                    <div className="px-3 pb-3 space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        {en.sessions.map((ses) => (
                                                            <div key={ses.id} className="flex items-center justify-between p-2.5 bg-background rounded-xl border border-muted/20 shadow-sm">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[11px] font-black text-foreground/80">{ses.date}</span>
                                                                    {ses.source !== 'self' && (
                                                                        <Badge variant="outline" className="text-[9px] font-black h-4 px-1.5 text-purple-600 border-purple-200 bg-purple-50">
                                                                            {ses.source === 'admin' ? '代報' : ses.source === 'makeup' ? '補課' : '轉讓'}
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-7 px-3 text-[10px] font-black text-rose-500 bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/10 rounded-lg transition-all active:scale-95"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        deleteSessionEnrollment(ses.id, ses.date, ses.source);
                                                                    }}
                                                                >
                                                                    取消此堂
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <ResetPasswordButton memberId={editMember?.id} />
                    <div className="p-6 pt-2 bg-muted/5 border-t border-muted/20 flex flex-col sm:flex-row gap-2">
                        <Button variant="ghost" onClick={() => setEditMember(null)} className="flex-1 font-bold text-muted-foreground/60 hover:text-muted-foreground bg-transparent hover:bg-muted/20 rounded-xl transition-all">
                            關閉視窗
                        </Button>
                        <Button onClick={handleSave} disabled={isPending} className="flex-[2] font-black bg-foreground text-background hover:bg-foreground/90 rounded-xl shadow-lg active:scale-[0.98] transition-all">
                            {isPending ? '儲存中...' : '確認變更'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
