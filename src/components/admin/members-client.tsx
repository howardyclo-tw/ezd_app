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
import { Search, Users, Crown, Shield, User, Calendar, ChevronDown, KeyRound, Plus, Trash2, Pencil } from 'lucide-react';
import { updateMemberProfile, resetMemberPassword, adminAddCards, createMemberGroup, updateMemberGroup, deleteMemberGroup } from '@/lib/supabase/actions';
import { safe } from '@/lib/supabase/safe-action';
import { ATTENDANCE_COLORS, ATTENDANCE_LABELS, ENROLL_TYPE_COLORS, ENROLL_TYPE_LABELS } from '@/lib/constants';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface CardPool {
    id: string;
    quantity: number;
    used: number;
    remaining: number;
    expires_at: string | null;
}

interface MemberGroup {
    id: string;
    name: string;
    validUntil: string;
}

interface MemberData {
    id: string;
    name: string;
    email: string | null;
    employee_id: string | null;
    role: string;
    member_group_id: string | null;
    card_balance: number;
    card_pools: CardPool[];
    makeup_quota: number; // Final available count
    makeup_base: number;  // sum(ceil(n/4))
    makeup_used: number;  // makeup + transfer used
    makeup_adj: number;   // manual adjustment from DB
    makeup_base_details: string[]; // ['Jazz(4)', 'Popping(2)']
    leader_courses: { courseName: string; groupTitle: string }[];
    enrollments: {
        courseId: string;
        courseName: string;
        teacher: string;
        groupTitle: string;
        enrollType: string;
        sessions: {
            id: string;
            date: string;
            source: string;
            attendance: string;
            sessionType: string;
        }[]
    }[];
}

interface MembersClientProps {
    members: MemberData[];
    memberGroups: MemberGroup[];
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

export function MembersClient({ members, memberGroups }: MembersClientProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [editMember, setEditMember] = useState<MemberData | null>(null);
    const [editRole, setEditRole] = useState('');
    const [editGroupId, setEditGroupId] = useState<string | null>(null);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDate, setNewGroupDate] = useState('');
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editGroupName, setEditGroupName] = useState('');
    const [editGroupDate, setEditGroupDate] = useState('');
    const [editMakeupAdj, setEditMakeupAdj] = useState<number>(0);
    const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
    const [addCardQty, setAddCardQty] = useState('');
    const [addCardExpiry, setAddCardExpiry] = useState('');

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
        setEditGroupId(member.member_group_id);
        setEditMakeupAdj(member.makeup_quota);
        setExpandedCourse(null);
        setAddCardQty('');
        setAddCardExpiry('');
    };

    const handleSave = () => {
        if (!editMember) return;

        const systemBaseline = editMember.makeup_quota - editMember.makeup_adj;
        const newAdj = editMakeupAdj - systemBaseline;

        startTransition(async () => {
            try {
                const result = await updateMemberProfile(editMember.id, {
                    role: editRole,
                    member_group_id: editGroupId,
                    makeup_quota: newAdj,
                });
                if (!result.success) {
                    toast.error(result.message);
                    return;
                }
                toast.success('成員資料已更新');
                setEditMember(null);
                setEditMakeupAdj(0);
                router.refresh();
            } catch (err: any) {
                toast.error(err.message || '更新失敗');
            }
        });
    };

    const handleAddCards = async () => {
        if (!editMember) return;
        const qty = parseInt(addCardQty);
        if (!qty || qty <= 0) { toast.error('請輸入有效數量'); return; }
        if (!addCardExpiry) { toast.error('請選擇到期日'); return; }

        try {
            const result = await safe(adminAddCards)(editMember.id, qty, addCardExpiry);
            if (result.success) {
                toast.success(result.message);
                setAddCardQty('');
                setAddCardExpiry('');
                // Close dialog and refresh to get updated data from server
                setEditMember(null);
                router.refresh();
            } else {
                toast.error(result.message);
            }
        } catch (err: any) {
            toast.error(err.message || '新增失敗');
        }
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
                        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
                        const memberGroup = memberGroups.find(g => g.id === member.member_group_id);
                        const isExpired = memberGroup && memberGroup.validUntil < today;

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
                                            <Badge variant="outline" className={cn("text-xs font-black h-4.5 px-1.5 uppercase tracking-tighter", roleInfo.color)}>
                                                {roleInfo.label}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-0.5 font-medium flex-wrap">
                                            {member.employee_id && <span>{member.employee_id}</span>}
                                            {memberGroup && (
                                                <span className={cn(
                                                    "flex items-center gap-1 font-bold",
                                                    isExpired ? "text-rose-500" : "text-muted-foreground"
                                                )}>
                                                    <Calendar className="h-3 w-3 text-muted-foreground/60" />
                                                    {memberGroup.name} {isExpired ? '(已到期)' : ''}
                                                </span>
                                            )}
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <div className={cn(
                                                    "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-black tracking-tighter transition-colors",
                                                    member.card_balance > 0 
                                                        ? "bg-orange-500/5 border-orange-500/20 text-orange-600" 
                                                        : "bg-muted/30 border-muted/50 text-muted-foreground/60"
                                                )}>
                                                    <span className="opacity-70">堂卡</span>
                                                    <span>{member.card_balance}</span>
                                                </div>
                                                <div className={cn(
                                                    "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-black tracking-tighter transition-colors",
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
                <DialogContent className="sm:max-w-[440px] max-h-[95vh] p-0 gap-0 border-none shadow-2xl rounded-3xl flex flex-col overflow-hidden">
                    {/* Scrollable content */}
                    <div className="flex-1 overflow-y-auto">
                        {/* Header */}
                        <div className="px-5 pt-5 pb-3">
                            <DialogHeader>
                                <DialogTitle className="text-lg font-black tracking-tight leading-tight">成員帳號管理</DialogTitle>
                                <DialogDescription className="mt-1.5 space-y-0.5">
                                    <span className="flex items-center gap-1.5 text-xs font-bold text-foreground/80">
                                        {editMember?.name}
                                        {editMember?.employee_id && (
                                            <span className="bg-muted px-1.5 py-0.5 rounded text-xs font-bold text-muted-foreground">{editMember.employee_id}</span>
                                        )}
                                    </span>
                                    {editMember?.email && (
                                        <span className="block text-xs text-muted-foreground/50 font-medium">{editMember.email}</span>
                                    )}
                                </DialogDescription>
                            </DialogHeader>
                        </div>

                        <div className="px-5 pb-5 space-y-4">
                            {/* Role */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-muted-foreground/50 tracking-widest ml-0.5">身份等級</label>
                                <Select value={editRole} onValueChange={setEditRole}>
                                    <SelectTrigger className="h-9 bg-muted/20 border-muted/30 text-[13px] font-bold rounded-lg focus:ring-0">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-lg border-muted/40 font-bold">
                                        {ROLE_OPTIONS.map(r => (
                                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Member Group (年度群組) — styled like course group selector */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-muted-foreground/50 tracking-widest ml-0.5">所屬年度群組</label>
                                <Select value={editGroupId || 'none'} onValueChange={(v) => setEditGroupId(v === 'none' ? null : v)}>
                                    <SelectTrigger className="h-9 bg-muted/20 border-muted/30 text-[13px] font-bold rounded-lg focus:ring-0">
                                        <SelectValue placeholder="未加入群組" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-lg border-muted/40">
                                        <SelectItem value="none" className="font-bold">未加入群組</SelectItem>
                                        
                                        <div className="h-px bg-muted my-1 font-bold" />
                                        
                                        {memberGroups.map(g => (
                                            <div key={g.id} className="flex items-center justify-between group px-1">
                                                <SelectItem value={g.id} className="flex-1 font-bold pr-16 truncate">
                                                    {g.name} <span className="text-muted-foreground font-normal ml-1">({g.validUntil})</span>
                                                </SelectItem>
                                                <div className="flex items-center gap-0.5 group px-1 absolute right-2">
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-6 w-6 text-muted-foreground hover:text-destructive transition-colors"
                                                        onClick={async (e) => { 
                                                            e.stopPropagation(); 
                                                            if(confirm('確定要刪除此群組嗎？')) {
                                                                const res = await safe(deleteMemberGroup)(g.id); 
                                                                if (res.success) { 
                                                                    toast.success(res.message); 
                                                                    if (editGroupId === g.id) setEditGroupId(null);
                                                                    router.refresh(); 
                                                                } else {
                                                                    toast.error(res.message);
                                                                }
                                                            }
                                                        }}>
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                                                        onClick={(e) => { 
                                                            e.stopPropagation(); 
                                                            setEditingGroupId(g.id); 
                                                            setEditGroupName(g.name); 
                                                            setEditGroupDate(g.validUntil); 
                                                        }}>
                                                        <Pencil className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        
                                        <div className="h-px bg-muted my-1" />
                                        
                                        {/* Inline create new group */}
                                        <div className="px-2 py-2 space-y-2">
                                            <div className="flex items-center gap-1.5 text-primary text-xs font-bold px-1 pb-1">
                                                <Plus className="h-3.5 w-3.5" /> 建立新群組
                                            </div>
                                            <div className="flex gap-1.5">
                                                <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="群組名稱" className="h-7 text-xs font-bold rounded px-2 flex-1" />
                                                <Input type="date" value={newGroupDate} onChange={(e) => setNewGroupDate(e.target.value)} className="h-7 text-xs font-bold rounded px-2 flex-1 w-[110px]" />
                                            </div>
                                            <Button variant="outline" size="sm" className="w-full h-7 text-xs font-bold rounded bg-primary/5 text-primary hover:bg-primary/10 border-primary/20 hover:text-primary transition-colors" disabled={!newGroupName || !newGroupDate} onClick={async () => {
                                                const res = await safe(createMemberGroup)(newGroupName, newGroupDate);
                                                if (res.success) { toast.success(res.message); setNewGroupName(''); setNewGroupDate(''); router.refresh(); }
                                                else toast.error(res.message);
                                            }}>
                                                儲存新群組
                                            </Button>
                                        </div>
                                    </SelectContent>
                                </Select>
                                {/* Edit group dialog (inline) */}
                                {editingGroupId && (() => {
                                    const g = memberGroups.find(g => g.id === editingGroupId);
                                    if (!g) return null;
                                    return (
                                        <div className="mt-2 p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-2 animate-in fade-in zoom-in-95 duration-200">
                                            <div className="flex items-center gap-1.5 text-primary text-xs font-bold mb-1">
                                                <Pencil className="h-3 w-3" /> 編輯群組
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] font-bold text-muted-foreground/60">名稱</label>
                                                    <Input value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="h-8 text-xs font-bold rounded-md bg-background" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-muted-foreground/60">到期日</label>
                                                    <Input type="date" value={editGroupDate} onChange={(e) => setEditGroupDate(e.target.value)} className="h-8 text-xs font-bold rounded-md bg-background" />
                                                </div>
                                            </div>
                                            <div className="flex gap-2 justify-end pt-1">
                                                <Button variant="ghost" size="sm" className="h-7 text-xs font-bold px-3 text-muted-foreground" onClick={() => setEditingGroupId(null)}>取消</Button>
                                                <Button variant="default" size="sm" className="h-7 text-xs font-bold px-4" onClick={async () => {
                                                    const res = await safe(updateMemberGroup)(editingGroupId, editGroupName, editGroupDate);
                                                    if (res.success) { toast.success(res.message); setEditingGroupId(null); router.refresh(); }
                                                    else toast.error(res.message);
                                                }}>儲存變更</Button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Reset Password */}
                            <ResetPasswordButton memberId={editMember?.id} />

                            {/* Card Pools */}
                            <div className="p-3 bg-muted/10 rounded-xl border border-muted/20 space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-black uppercase text-muted-foreground/50 tracking-widest">堂卡餘額</label>
                                    <span className="text-[13px] font-black tabular-nums">{editMember?.card_balance ?? 0} <span className="text-xs font-bold text-muted-foreground/50">張</span></span>
                                </div>

                                {editMember?.card_pools && editMember.card_pools.filter(p => p.remaining > 0).length > 0 ? (
                                    <div className="space-y-1 max-h-[100px] overflow-y-auto scrollbar-hide">
                                        {editMember.card_pools.filter(p => p.remaining > 0).map(pool => {
                                            const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
                                            const isExpired = pool.expires_at && pool.expires_at < today;
                                            return (
                                                <div key={pool.id} className={cn(
                                                    "flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs",
                                                    isExpired ? "bg-rose-500/5 border border-rose-500/10" : "bg-background/60 border border-muted/15"
                                                )}>
                                                    <span className={cn("font-black tabular-nums", isExpired ? "text-rose-500 line-through" : "text-foreground/80")}>
                                                        {pool.remaining} 張
                                                    </span>
                                                    <span className={cn("font-medium", isExpired ? "text-rose-400" : "text-muted-foreground/60")}>
                                                        {isExpired ? '已過期' : `到期 ${pool.expires_at}`}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground/40 italic text-center py-1">無堂卡紀錄</p>
                                )}

                                <p className="text-[10px] text-muted-foreground/40 font-medium">* 到期日後的課程堂次無法使用該批堂卡報名</p>

                                {/* Add cards inline form */}
                                <div className="flex gap-1.5 items-end pt-0.5 border-t border-muted/10">
                                    <div className="w-16">
                                        <label className="text-[10px] font-bold text-muted-foreground/40 ml-0.5">數量</label>
                                        <Input
                                            type="number"
                                            placeholder="0"
                                            value={addCardQty}
                                            onChange={(e) => setAddCardQty(e.target.value)}
                                            min={1}
                                            className="h-8 text-xs font-bold rounded-md px-2"
                                            inputMode="numeric"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-muted-foreground/40 ml-0.5">到期日</label>
                                        <Input
                                            type="date"
                                            value={addCardExpiry}
                                            onChange={(e) => setAddCardExpiry(e.target.value)}
                                            className="h-8 text-xs font-bold rounded-md px-2"
                                        />
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 px-3 text-xs font-black rounded-md shrink-0"
                                        onClick={handleAddCards}
                                        disabled={!addCardQty || !addCardExpiry}
                                    >
                                        新增
                                    </Button>
                                </div>
                            </div>

                            {/* Makeup Quota */}
                            <div className="p-3 bg-[#FF6B00]/5 rounded-xl border border-[#FF6B00]/10 space-y-1.5">
                                <label className="text-[10px] font-black uppercase text-[#FF6B00]/60 tracking-widest">總補課額度</label>
                                <Input
                                    type="number"
                                    value={editMakeupAdj === 0 ? '' : editMakeupAdj}
                                    onChange={(e) => setEditMakeupAdj(e.target.value === '' ? 0 : parseInt(e.target.value))}
                                    className="h-9 bg-background border-[#FF6B00]/20 text-[13px] font-black text-[#FF6B00] rounded-lg focus-visible:ring-0 placeholder:text-[#FF6B00]/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    placeholder="0"
                                    inputMode="numeric"
                                />
                                <p className="text-[10px] text-[#FF6B00]/40 font-medium leading-relaxed">
                                    系統 {editMember ? editMember.makeup_quota - editMember.makeup_adj : 0} + 手動 {editMember ? editMakeupAdj - (editMember.makeup_quota - editMember.makeup_adj) : 0}。手動部分不受 1/4 限制。
                                </p>
                            </div>

                            {/* Enrollments */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-black uppercase text-muted-foreground/50 tracking-widest">已報名課程</label>
                                    <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded-md text-xs font-black">{editMember?.enrollments.length || 0} 課程</span>
                                </div>

                                {editMember?.enrollments.length === 0 ? (
                                    <div className="py-6 text-center bg-muted/5 rounded-xl border border-dashed border-muted/30">
                                        <p className="text-xs text-muted-foreground/40 font-bold italic">目前查無報名紀錄</p>
                                    </div>
                                ) : (
                                    <div className="space-y-1.5 max-h-[240px] overflow-y-auto scrollbar-hide">
                                        {editMember?.enrollments.map((en, i) => {
                                            const isExpanded = expandedCourse === en.courseId;
                                            return (
                                                <div key={i} className={cn(
                                                    "border rounded-xl overflow-hidden transition-all",
                                                    isExpanded ? "border-primary/20 bg-primary/5" : "border-muted/20 bg-muted/5"
                                                )}>
                                                    <div
                                                        className="flex items-center justify-between px-3 py-2 cursor-pointer"
                                                        onClick={() => setExpandedCourse(isExpanded ? null : en.courseId)}
                                                    >
                                                        <div className="flex flex-col min-w-0 gap-0.5">
                                                            <span className="text-[10px] text-muted-foreground/50 font-bold uppercase tracking-tight">{en.groupTitle}</span>
                                                            <span className="text-xs font-black text-foreground/90 truncate leading-tight">{en.teacher} {en.courseName}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                                            <Badge variant="outline" className={cn("text-xs font-black h-4 px-1 border-none rounded-md",
                                                                en.enrollType === 'full' ? "bg-primary/10 text-primary"
                                                                    : ENROLL_TYPE_COLORS[en.enrollType] || "bg-orange-500/10 text-orange-500"
                                                            )}>
                                                                {en.enrollType === 'full' ? '整期' : ENROLL_TYPE_LABELS[en.enrollType] || en.enrollType}
                                                            </Badge>
                                                            <span className="text-xs font-bold text-muted-foreground/40 tabular-nums">{en.sessions.length}堂</span>
                                                            <ChevronDown className={cn("h-3 w-3 text-muted-foreground/30 transition-transform", isExpanded && "rotate-180")} />
                                                        </div>
                                                    </div>

                                                    {isExpanded && (
                                                        <div className="px-2.5 pb-2.5 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                                            {en.sessions.map((ses) => {
                                                                const showAttBadge = ses.attendance !== 'unmarked'
                                                                    && ATTENDANCE_LABELS[ses.attendance]
                                                                    && !(ses.sessionType === 'makeup' && ses.attendance === 'makeup')
                                                                    && !(ses.sessionType === 'transfer_in' && ses.attendance === 'transfer_in');

                                                                return (
                                                                    <div key={ses.id} className={cn(
                                                                        "flex items-center gap-1.5 px-2 py-1.5 bg-background/60 rounded-lg border text-xs",
                                                                        ses.attendance === 'transfer_out' ? "border-muted/10 opacity-40" : "border-muted/15"
                                                                    )}>
                                                                        <span className="font-bold text-foreground/70 tabular-nums">{ses.date}</span>
                                                                        {ENROLL_TYPE_LABELS[ses.sessionType] && (
                                                                            <Badge variant="outline" className={cn("text-xs font-black h-3 px-0.5 border-none rounded-sm leading-none", ENROLL_TYPE_COLORS[ses.sessionType] || 'bg-muted/30 text-muted-foreground')}>
                                                                                {ENROLL_TYPE_LABELS[ses.sessionType]}
                                                                            </Badge>
                                                                        )}
                                                                        {showAttBadge && (
                                                                            <Badge variant="outline" className={cn("text-xs font-black h-3 px-0.5 border-none rounded-sm leading-none", ATTENDANCE_COLORS[ses.attendance])}>
                                                                                {ATTENDANCE_LABELS[ses.attendance]}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Fixed footer */}
                    <div className="shrink-0 px-5 py-3 bg-muted/5 border-t border-muted/15 flex gap-2">
                        <Button variant="ghost" onClick={() => setEditMember(null)} className="flex-1 h-10 font-bold text-muted-foreground/50 hover:text-muted-foreground rounded-lg text-[13px]">
                            關閉
                        </Button>
                        <Button onClick={handleSave} disabled={isPending} className="flex-[2] h-10 font-black bg-foreground text-background hover:bg-foreground/90 rounded-lg shadow-md active:scale-[0.98] text-[13px]">
                            {isPending ? '儲存中...' : '確認變更'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
