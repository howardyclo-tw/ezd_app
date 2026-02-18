'use client';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LogOut, LayoutDashboard } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

interface UserNavProps {
    user: User;
    role: string | null;
}

const roleLabels: Record<string, string> = {
    admin: '管理員',
    leader: '班長',
    member: '社員',
    guest: '非社員',
};

export function UserNav({ user, role }: UserNavProps) {
    const router = useRouter();

    const handleSignOut = async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
    };

    const roleLabel = role ? (roleLabels[role] || '非社員') : '非社員';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full h-8 w-8 p-0 border border-transparent hover:border-muted">
                    <div className="h-full w-full rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                        {user.email?.charAt(0).toUpperCase() || 'U'}
                    </div>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-bold truncate">帳戶資訊</p>
                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-primary/10 text-primary border-none">
                                {roleLabel}
                            </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate font-medium">
                            {user.email}
                        </p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/dashboard')} className="cursor-pointer">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    <span>儀表板</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut} className="text-red-600 focus:text-red-600 cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>登出</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
