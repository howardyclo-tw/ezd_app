import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { PlusCircle, Calendar, Users, LayoutDashboard, Clock, ArrowRight } from 'lucide-react';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/auth/logout-button';

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
  const isAdminOrLeader = userRole === 'admin' || userRole === 'leader';

  // Redirect logic removed for debugging.
  // Instead, we show a restricted view if not admin.

  if (!isAdminOrLeader) {
    return (
      <div className="py-10 text-center space-y-4">
        <div className="mx-auto h-20 w-20 bg-muted rounded-full flex items-center justify-center">
          <span className="text-4xl">🚫</span>
        </div>
        <h1 className="text-2xl font-bold">權限不足</h1>
        <p className="text-muted-foreground">
          您目前的身份為 <span className="font-bold text-primary">{roleLabels[userRole]}</span>，
          沒有權限存取幹部後台。
        </p>
        <p className="text-xs text-muted-foreground">
          (開發模式提示：請使用右上角的「身分切換」工具將自己切換為「幹部」)
        </p>
        <Button asChild className="mt-4">
          <Link href="/courses">前往課程管理</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xs font-bold uppercase tracking-widest text-primary/60">幹部後台</h2>
          <h1 className="text-2xl font-bold tracking-tight">早安，{displayName}</h1>
          <p className="text-sm text-muted-foreground">
            今天是 {new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-2.5 bg-muted/30 px-3 py-1.5 rounded-full">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
            {displayName.charAt(0)}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium truncate max-w-[160px]">{user.email}</span>
            <span className="text-[10px] font-bold text-primary">{roleLabels[userRole]}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Link href="/courses" className="block">
          <Card className="border-muted hover:border-primary/30 shadow-none hover:shadow-sm transition-all h-full group">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold group-hover:text-primary transition-colors">課程總覽</h3>
                <p className="text-xs text-muted-foreground">查看所有課程</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        {isAdminOrLeader && (
          <Link href="/courses/new" className="block">
            <Card className="border-dashed border-primary/30 bg-primary/5 shadow-none hover:shadow-sm hover:border-primary/50 transition-all h-full group">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg shrink-0 group-hover:bg-primary transition-colors">
                  <PlusCircle className="h-5 w-5 text-primary group-hover:text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">新增課程</h3>
                  <p className="text-xs text-muted-foreground">建立新一期課程</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {userRole === 'admin' && (
          <Card className="border-muted shadow-none opacity-50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg shrink-0">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-muted-foreground">社員管理</h3>
                <p className="text-xs text-muted-foreground">即將開放</p>
              </div>
            </CardContent>
          </Card>
        )}

        {userRole === 'admin' && (
          <Card className="border-muted shadow-none opacity-50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-muted rounded-lg shrink-0">
                <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-muted-foreground">統計報表</h3>
                <p className="text-xs text-muted-foreground">即將開放</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Task + Status */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">近期任務</h3>
          <Card className="border-muted/60 shadow-sm">
            <CardContent className="p-0">
              <div className="px-4 py-3 flex items-center gap-3 hover:bg-muted/5 transition-colors border-b border-muted/20">
                <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm">今日課程點名</h4>
                  <p className="text-xs text-muted-foreground truncate">基礎律動 (A-May) • 19:00 - A教室</p>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs font-bold rounded-full shrink-0">
                  前往
                </Button>
              </div>
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                沒有更多待辦事項
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">帳號狀態</h3>
          <Card className="border-muted/60 shadow-sm">
            <CardContent className="px-4 py-3 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">工號</span>
                <span className="text-xs font-bold">{profile?.employee_id || '-'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">身份</span>
                <span className="text-xs font-bold">{roleLabels[userRole]}</span>
              </div>
              <div className="border-t border-muted/30 pt-3 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">社員資格</span>
                {profile?.member_valid_until ? (
                  <Badge variant="outline" className="text-[10px] h-5 text-green-600 bg-green-500/10 border-green-200">
                    有效至 {new Date(profile.member_valid_until).toLocaleDateString('zh-TW')}
                  </Badge>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">未開通</span>
                )}
              </div>
              <div className="border-t border-muted/30 pt-3">
                <LogoutButton />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
