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
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="text-red-600 hover:text-white hover:bg-red-600 border-red-200 hover:border-red-600 font-bold px-6 rounded-xl transition-all shadow-sm active:scale-95"
        >
            <LogOut className="mr-2 h-4 w-4" />
            登出系統
        </Button>
    );
}
