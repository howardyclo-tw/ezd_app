'use client';

import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import type { Profile } from '@/types/database';
import { LogOut, User, Settings, Shield } from 'lucide-react';

export default function ProfilePage() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        const fetchProfile = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', user.id)
                    .single();
                setProfile(data);
            }
            setLoading(false);
        };
        fetchProfile();
    }, [supabase]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.href = '/login';
    };

    if (loading) return null;

    return (
        <div className="container max-w-xl py-8 pb-24">
            <div className="flex flex-col items-center mb-8">
                <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center mb-4 ring-4 ring-primary/5 shadow-inner">
                    <User className="h-12 w-12 text-primary" />
                </div>
                <h1 className="text-2xl font-bold">{profile?.name || '使用者'}</h1>
                <Badge variant="secondary" className="mt-2 px-4 py-1 rounded-full font-bold uppercase tracking-tighter bg-primary/10 text-primary border-none text-[10px]">
                    {profile?.role === 'admin' ? '幹部' : profile?.role === 'leader' ? '班長' : profile?.role === 'member' ? '社員' : '非社員'}
                </Badge>
            </div>

            <div className="space-y-4">
                <Card className="border-muted/50 shadow-sm overflow-hidden">
                    <CardHeader className="bg-muted/5 pb-4">
                        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center">
                            <Shield className="h-4 w-4 mr-2" /> 帳號資訊
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-muted/30">
                            {profile?.employee_id && (
                                <div className="p-4 flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground font-medium">工號</span>
                                    <span className="text-sm font-bold">{profile.employee_id}</span>
                                </div>
                            )}
                            <div className="p-4 flex justify-between items-center">
                                <span className="text-sm text-muted-foreground font-medium">身份別</span>
                                <span className="text-sm font-bold capitalize">{profile?.role}</span>
                            </div>
                            {profile?.member_valid_until && (
                                <div className="p-4 flex justify-between items-center bg-primary/5">
                                    <span className="text-sm text-primary/80 font-bold">社員資格到期</span>
                                    <span className="text-sm font-bold text-primary">
                                        {new Date(profile.member_valid_until).toLocaleDateString('zh-TW')}
                                    </span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <div className="grid gap-3 pt-4">
                    <Button variant="outline" className="w-full justify-start h-12 rounded-xl border-muted-foreground/10 hover:bg-muted/5 shadow-sm">
                        <Settings className="mr-3 h-4 w-4 text-muted-foreground" />
                        帳號設定
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleLogout}
                        className="w-full justify-start h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white border-none shadow-md font-bold transition-all active:scale-95"
                    >
                        <LogOut className="mr-3 h-4 w-4" />
                        登出系統
                    </Button>
                </div>
            </div>
        </div>
    );
}

