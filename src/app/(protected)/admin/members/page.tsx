import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { ChevronLeft, Users } from "lucide-react";
import Link from 'next/link';
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profile?.role !== 'admin') {
        redirect('/dashboard');
    }

    return (
        <div className="container max-w-5xl py-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" asChild className="rounded-full h-9 w-9 -ml-2 shrink-0">
                        <Link href="/dashboard"><ChevronLeft className="h-5 w-5" /></Link>
                    </Button>
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight leading-tight">社員管理</h1>
                        <p className="text-sm text-muted-foreground font-medium mt-0.5">
                            管理全體社員權限、會籍期限與基本資訊
                        </p>
                    </div>
                </div>
            </div>

            <Card className="border-dashed border-muted/50 bg-muted/5">
                <CardContent className="flex flex-col items-center justify-center py-24 text-center">
                    <div className="h-16 w-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                        <Users className="h-8 w-8 text-muted-foreground/40" />
                    </div>
                    <h3 className="text-lg font-bold text-foreground/80">社員管理介面開發中</h3>
                    <p className="text-sm text-muted-foreground mt-1 px-4 max-w-sm">
                        此功能目前正在進行內部開發與數據對帳中，將於近期開放。
                    </p>
                    <Button variant="outline" className="mt-8 font-bold" asChild>
                        <Link href="/dashboard">返回控制台</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
