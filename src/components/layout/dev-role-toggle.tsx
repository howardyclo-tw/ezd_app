'use client';

import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Settings2, Crown, ShieldCheck, User, Ghost, Loader2, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUserRole } from '@/components/providers/role-provider';
import { toast } from 'sonner';
import { updateUserRole } from '@/actions/user-actions';

const roles = [
    { value: 'admin', label: '幹部', icon: ShieldCheck },
    { value: 'leader', label: '班長', icon: Crown },
    { value: 'member', label: '社員', icon: User },
    { value: 'guest', label: '非社員', icon: Ghost },
];

export interface DevRoleToggleProps {
    userId: string;
}

export function DevRoleToggle({ userId }: DevRoleToggleProps) {
    const { role: currentRole, setRole } = useUserRole();
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleRoleUpdate = async (newRole: string) => {
        if (newRole === currentRole || isPending) return;

        // 1. Optimistic Update
        const previousRole = currentRole;
        setRole(newRole);

        const toastId = toast.loading('正在同步權限設定...');

        // 2. Server Action Update and Revalidate
        startTransition(async () => {
            const result = await updateUserRole(userId, newRole);

            if (!result.success) {
                // Revert UI on failure
                setRole(previousRole);
                toast.error(`切換失敗: ${result.error || '未知錯誤'}`, { id: toastId });
                console.error('Role update failed:', result.error);
            } else {
                toast.success(`身分已切換`, { id: toastId, duration: 2000 });
                // We rely on revalidatePath in the server action to update server components
            }
        });
    };

    const activeRole = roles.find(r => r.value === currentRole);
    const RoleIcon = activeRole?.icon || Settings2;

    if (!currentRole) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-8 gap-2 border-dashed border-primary/50 bg-primary/5 text-xs font-bold transition-all rounded-full hover:bg-primary/10",
                        isPending && "opacity-80"
                    )}
                >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <RoleIcon className="h-3.5 w-3.5" />}

                    <span className="hidden sm:inline">
                        身分: {activeRole?.label || '未定義'}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-lg border-border/80 bg-background/95 backdrop-blur-md">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/70 px-3 py-2">
                    開發者工具: 切換身分
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {roles.map((role) => {
                    const Icon = role.icon;
                    const isActive = currentRole === role.value;
                    return (
                        <DropdownMenuItem
                            key={role.value}
                            onClick={() => handleRoleUpdate(role.value)}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2 text-xs font-bold cursor-pointer transition-colors focus:bg-primary/10",
                                isActive ? "bg-primary/5 text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground/70")} />
                            <span>{role.label}</span>
                            {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                        </DropdownMenuItem>
                    );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={async () => {
                        const supabase = createClient();
                        await supabase.auth.signOut();
                        router.push('/login');
                        router.refresh();
                    }}
                    className="flex items-center gap-3 px-3 py-2 text-xs font-bold cursor-pointer transition-colors text-red-500 focus:bg-red-500/10 hover:bg-red-500/10 focus:text-red-500"
                >
                    <LogOut className="h-4 w-4" />
                    <span>登出系統</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
