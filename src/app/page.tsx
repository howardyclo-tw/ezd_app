import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center space-y-8 px-4 py-12">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
          EZD App
        </h1>
        <p className="text-xl text-muted-foreground">
          熱舞社管理系統
        </p>
        <p className="text-sm text-muted-foreground">
          Dance Club Management System
        </p>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>歡迎使用</CardTitle>
          <CardDescription>
            請登入或註冊以開始使用系統
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                您已登入為 {user.email}
              </p>
              <Button asChild className="w-full">
                <Link href="/dashboard">前往儀表板</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button asChild className="w-full">
                <Link href="/login">登入</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/register">註冊</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

