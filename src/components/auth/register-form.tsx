'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) {
      toast.error('註冊失敗', {
        description: error.message,
      });
      setLoading(false);
      return;
    }

    toast.success('註冊成功', {
      description: '請檢查您的電子郵件以驗證帳號',
    });
    
    // Redirect to login after a short delay
    setTimeout(() => {
      router.push('/login');
    }, 2000);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>註冊</CardTitle>
        <CardDescription>建立新帳號</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">姓名</Label>
            <Input
              id="name"
              type="text"
              placeholder="請輸入您的姓名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={loading}
            />
          </div>
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
              placeholder="至少 6 個字元"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '註冊中...' : '註冊'}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <span className="text-muted-foreground">已有帳號？</span>{' '}
          <a href="/login" className="text-primary hover:underline">
            登入
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

