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
import { Search, Edit2, Users, Crown, Shield, User, Calendar } from 'lucide-react';
import { updateMemberProfile } from '@/lib/supabase/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface MemberData {
    id: string;
    name: string;
    employee_id: string | null;
    role: string;
    member_valid_until: string | null;
    card_balance: number;
    leader_courses: { courseName: string; groupTitle: string }[];
}

interface MembersClientProps {
    members: MemberData[];
}

const ROLE_OPTIONS = [
    { value: 'guest', label: '非社員', color: 'text-muted-foreground border-muted' },
    { value: 'member', label: '社員', color: 'text-blue-600 border-blue-500/30 bg-blue-500/5' },
    { value: 'leader', label: '班長', color: 'text-amber-600 border-amber-500/30 bg-amber-500/5' },
    { value: 'admin', label: '管理員', color: 'text-purple-600 border-purple-500/30 bg-purple-500/5' },
];

function getRoleInfo(role: string) {
    return ROLE_OPTIONS.find(r => r.value === role) || ROLE_OPTIONS[0];
}

function getRoleIcon(role: string) {
    switch (role) {
        case 'admin': return <Shield className="h-3 w-3" />;
        case 'leader': return <Crown className="h-3 w-3" />;
        case 'member': return <Users className="h-3 w-3" />;
        default: return <User className="h-3 w-3" />;
    }
}

export function MembersClient({ members }: MembersClientProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [editMember, setEditMember] = useState<MemberData | null>(null);
    const [editRole, setEditRole] = useState('');
    const [editValidUntil, setEditValidUntil] = useState('');

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
        leader: members.filter(m => m.role === 'leader').length,
        member: members.filter(m => m.role === 'member').length,
        guest: members.filter(m => m.role === 'guest').length,
    };

    const openEdit = (member: MemberData) => {
        setEditMember(member);
        setEditRole(member.role);
        setEditValidUntil(member.member_valid_until || '');
    };

    const handleSave = () => {
        if (!editMember) return;
        startTransition(async () => {
            try {
                await updateMemberProfile(editMember.id, {
                    role: editRole,
                    member_valid_until: editValidUntil || null,
                });
                toast.success('社員資料已更新');
                setEditMember(null);
                router.refresh();
            } catch (err: any) {
                toast.error(err.message || '更新失敗');
            }
        });
    };

    return (
        <>
            {/* Stats Pills */}
            <div className="flex flex-wrap gap-2">
                {(['all', 'admin', 'leader', 'member', 'guest'] as const).map(r => (
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
                    className="pl-10 h-11 bg-muted/20 border-muted/40"
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
                        const isExpired = member.member_valid_until &&
                            new Date(member.member_valid_until) < new Date();

                        return (
                            <Card
                                key={member.id}
                                className="border-muted/40 bg-card hover:bg-muted/10 transition-colors group"
                            >
                                <CardContent className="p-4 flex items-center gap-4">
                                    {/* Avatar / Role Icon */}
                                    <div className={cn(
                                        "h-10 w-10 rounded-full flex items-center justify-center shrink-0 border",
                                        roleInfo.color
                                    )}>
                                        {getRoleIcon(member.role)}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-bold text-sm truncate">{member.name}</span>
                                            <Badge variant="outline" className={cn("text-[10px] font-bold gap-1", roleInfo.color)}>
                                                {getRoleIcon(member.role)} {roleInfo.label}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                                            {member.employee_id && (
                                                <span>工號 {member.employee_id}</span>
                                            )}
                                            {member.member_valid_until && (
                                                <span className={cn(
                                                    "flex items-center gap-1",
                                                    isExpired && "text-red-500"
                                                )}>
                                                    <Calendar className="h-3 w-3" />
                                                    {isExpired ? '已到期' : '有效至'} {member.member_valid_until}
                                                </span>
                                            )}
                                            <span>堂卡 {member.card_balance}</span>
                                        </div>
                                        {member.leader_courses.length > 0 && (
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                                                <span className="text-[10px] text-amber-600 font-bold">
                                                    班長：{member.leader_courses.map(c => c.courseName).join('、')}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Edit Button */}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => openEdit(member)}
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>

            {/* Edit Dialog */}
            <Dialog open={!!editMember} onOpenChange={(open) => !open && setEditMember(null)}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>編輯社員資料</DialogTitle>
                        <DialogDescription>
                            {editMember?.name}
                            {editMember?.employee_id && ` (工號 ${editMember.employee_id})`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-bold">身份</label>
                            <Select value={editRole} onValueChange={setEditRole}>
                                <SelectTrigger className="h-11">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {ROLE_OPTIONS.map(r => (
                                        <SelectItem key={r.value} value={r.value}>
                                            {r.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold">社員有效期限</label>
                            <Input
                                type="date"
                                value={editValidUntil}
                                onChange={(e) => setEditValidUntil(e.target.value)}
                                className="h-11"
                            />
                            <p className="text-[11px] text-muted-foreground">留空代表無期限，通常設定為年度結束日</p>
                        </div>

                        {editMember && editMember.leader_courses.length > 0 && (
                            <div className="space-y-2">
                                <label className="text-sm font-bold">擔任班長的課程</label>
                                <div className="space-y-1">
                                    {editMember.leader_courses.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg px-3 py-2">
                                            <Crown className="h-3 w-3 text-amber-500 shrink-0" />
                                            <span className="font-bold">{c.courseName}</span>
                                            <span className="text-muted-foreground">({c.groupTitle})</span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-[11px] text-muted-foreground">班長指派請至課程編輯頁面管理</p>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditMember(null)}>取消</Button>
                        <Button onClick={handleSave} disabled={isPending}>
                            {isPending ? '儲存中...' : '儲存'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
