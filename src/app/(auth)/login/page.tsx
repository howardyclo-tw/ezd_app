import { LoginForm } from '@/components/auth/login-form';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect if already logged in
  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
      <LoginForm />
    </div>
  );
}

