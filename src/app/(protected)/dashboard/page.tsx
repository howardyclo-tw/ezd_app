import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
  PlusCircle,
  Calendar,
  Users,
  LayoutDashboard,
  Clock,
  ArrowRight,
  Crown,
  ShieldCheck,
  User,
  CreditCard,
  Star,
  ChevronRight,
  UserSquare,
  Banknote
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/auth/logout-button';
import { cn } from '@/lib/utils';


export const dynamic = 'force-dynamic';

const roleLabels: Record<string, string> = {
  guest: '非社員',
  member: '社員',
  leader: '班長',
  admin: '幹部',
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const displayName = profile?.name || user.email?.split('@')[0] || '使用者';
  const userRole = profile?.role || 'guest';
  const isAdmin = userRole === 'admin';
  const isLeader = userRole === 'leader';
  const isLeaderOrAdmin = isAdmin || isLeader;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-10 pb-24">

      {/* 1. Compact Info Row (Unified Bar) */}
      <div className="flex flex-col items-center text-center">
        <div className="bg-muted/30 backdrop-blur-sm border border-muted-foreground/10 px-4 sm:px-6 py-2.5 rounded-2xl flex flex-row items-center gap-3 sm:gap-4 bg-muted/20 shadow-sm transition-all whitespace-nowrap overflow-hidden max-w-full">
          <p className="text-sm font-bold flex items-center gap-2 truncate">
            <span className="text-base shrink-0">👋</span>
            <span className="text-foreground tracking-tight underline decoration-primary/30 underline-offset-8 decoration-2 truncate max-w-[120px] sm:max-w-none">{displayName}</span>
          </p>

          <div className="h-3 w-[1px] bg-muted-foreground/20 shrink-0" />

          <div className="flex items-center shrink-0">
            <Badge variant="secondary" className="bg-foreground text-background border-none font-bold px-1.5 py-0 h-5 text-[10px] rounded-md shadow-sm uppercase tracking-wider whitespace-nowrap">
              {roleLabels[userRole]}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* 2. My Courses Navigation */}
        <Link href="/profile/courses" className="group">
          <Card className="h-full border-muted/60 shadow-sm hover:border-primary/40 transition-all overflow-hidden">
            <CardContent className="p-0">
              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-5">
                    <div className="h-12 w-12 rounded-2xl bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-background transition-all duration-300 shrink-0">
                      <Calendar className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold tracking-tight">我的課程</h2>
                      <p className="text-sm text-muted-foreground font-medium">查看預約、報名與課表</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground/30 group-hover:text-primary transition-all shrink-0" />
                </div>

                <div className="pt-6 border-t border-muted/40 flex items-center gap-8">
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">本期補課</p>
                    <p className="text-lg font-bold">2 <span className="text-xs opacity-40">/ 2 堂</span></p>
                  </div>
                  <div className="h-8 w-[1px] bg-muted/40" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">即將到來</p>
                    <p className="text-lg font-bold">4 <span className="text-xs opacity-40">堂</span></p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* 3. My Cards Navigation */}
        <Link href="/profile/cards" className="group">
          <Card className="h-full border-muted/60 shadow-sm hover:border-primary/40 transition-all overflow-hidden">
            <CardContent className="p-0">
              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-5">
                    <div className="h-12 w-12 rounded-2xl bg-orange-500/5 flex items-center justify-center text-orange-600 group-hover:bg-orange-600 group-hover:text-white transition-all duration-300 shrink-0">
                      <CreditCard className="h-6 w-6" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold tracking-tight">我的堂卡</h2>
                      <p className="text-sm text-muted-foreground font-medium">管理餘額、購卡與紀錄</p>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground/30 group-hover:text-orange-600 transition-all shrink-0" />
                </div>

                <div className="pt-6 border-t border-muted/40 flex items-center gap-8">
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">剩餘堂數</p>
                    <p className="text-lg font-bold text-orange-600">8 <span className="text-xs opacity-40">堂</span></p>
                  </div>
                  <div className="h-8 w-[1px] bg-muted/40" />
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">待繳費</p>
                    <p className="text-lg font-bold">0 <span className="text-xs opacity-40">筆</span></p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 4. Role Specific Tools */}
      {isLeaderOrAdmin && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-muted" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              幹部行政工具
            </span>
            <div className="h-px flex-1 bg-muted" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link href="/leader/rollcall">
              <div className="flex items-center gap-4 p-4 rounded-2xl border border-muted/60 bg-card hover:border-primary/40 hover:bg-primary/5 transition-all group">
                <div className="h-10 w-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-background transition-all">
                  <Users className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold">今日點名 (Rollcall)</p>
                  <p className="text-[10px] text-muted-foreground font-bold">查看課堂名單與出席紀錄</p>
                </div>
              </div>
            </Link>

            {isAdmin && (
              <>
                <Link href="/courses/new">
                  <div className="flex items-center gap-4 p-4 rounded-2xl border border-muted/60 bg-card hover:border-primary/40 hover:bg-primary/5 transition-all group">
                    <div className="h-10 w-10 rounded-xl bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-background transition-all">
                      <PlusCircle className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold">新增課程 (Create)</p>
                      <p className="text-[10px] text-muted-foreground font-bold">建立新的常態或 MV 班級</p>
                    </div>
                  </div>
                </Link>

                <div className="flex items-center gap-4 p-4 rounded-2xl border border-dashed border-muted/40 bg-muted/5 opacity-50 cursor-not-allowed">
                  <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
                    <UserSquare className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold grayscale">社員管理 (Dev)</p>
                    <p className="text-[10px] text-muted-foreground font-bold">管理權限與資歷資訊</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
