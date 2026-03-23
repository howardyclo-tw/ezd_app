'use client';

import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
    const router = useRouter();

    const handleSignOut = async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/login');
        router.refresh();
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="h-9 px-3 text-white/60 hover:text-rose-400 hover:bg-rose-400/5 transition-all flex items-center gap-2 rounded-xl"
        >
            <LogOut className="h-4 w-4 text-rose-500" />
            <span className="text-sm font-bold tracking-tight">登出系統</span>
        </Button>
    );
}
