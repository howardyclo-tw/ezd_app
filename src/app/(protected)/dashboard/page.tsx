import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from 'next/navigation';
import type { Profile } from '@/types/database';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    redirect('/login');
  }

  const roleLabels: Record<string, string> = {
    guest: '非社員',
    member: '社員',
    leader: '班長',
    staff: '幹部',
  };

  return (
    <div className="space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-bold">儀表板</h1>
        <p className="text-muted-foreground">歡迎回來，{profile.name}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>個人資料</CardTitle>
            <CardDescription>您的帳號資訊</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <span className="text-sm font-medium">姓名：</span>
              <span className="text-sm">{profile.name}</span>
            </div>
            <div>
              <span className="text-sm font-medium">電子郵件：</span>
              <span className="text-sm">{user.email}</span>
            </div>
            <div>
              <span className="text-sm font-medium">身份：</span>
              <span className="text-sm">{roleLabels[profile.role] || profile.role}</span>
            </div>
            {profile.employee_id && (
              <div>
                <span className="text-sm font-medium">工號：</span>
                <span className="text-sm">{profile.employee_id}</span>
              </div>
            )}
            {profile.member_valid_until && (
              <div>
                <span className="text-sm font-medium">社員資格到期日：</span>
                <span className="text-sm">
                  {new Date(profile.member_valid_until).toLocaleDateString('zh-TW')}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>快速功能</CardTitle>
            <CardDescription>常用功能入口</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              功能開發中，敬請期待...
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

