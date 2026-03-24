'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { registerUserAction } from '@/lib/supabase/actions';

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.endsWith('@mediatek.com')) {
      toast.error('註冊限制', {
        description: '僅限 mediatek.com 電子郵件註冊',
      });
      return;
    }

    setLoading(true);

    try {
      const result = await registerUserAction({
        email,
        password,
        name,
        employee_id: employeeId || undefined,
      });

      if (!result.success) {
        toast.error('註冊失敗', { description: result.message });
        setLoading(false);
        return;
      }

      toast.success('註冊成功', {
        description: '帳號已建立，即將跳轉至登入頁面',
      });

      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      toast.error('註冊失敗', { description: err.message });
      setLoading(false);
    }
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
            <Label htmlFor="employeeId">工號</Label>
            <Input
              id="employeeId"
              type="text"
              placeholder="例：12345"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">mtk 開頭請寫數字即可，例：mtkxxxxx → xxxxx</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">電子郵件</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@mediatek.com"
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
