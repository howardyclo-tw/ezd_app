'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error('登入失敗', {
        description: error.message,
      });
      setLoading(false);
      return;
    }

    toast.success('登入成功');
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>登入</CardTitle>
        <CardDescription>請輸入您的電子郵件和密碼</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">電子郵件</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密碼</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '登入中...' : '登入'}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <span className="text-muted-foreground">還沒有帳號？</span>{' '}
          <a href="/register" className="text-primary hover:underline">
            註冊
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

