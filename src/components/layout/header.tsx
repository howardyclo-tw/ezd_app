import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { NavLinks } from './nav-links';
import { DevRoleToggle } from './dev-role-toggle';

export const dynamic = 'force-dynamic';

export async function Header() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    role = profile?.role || 'guest';
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">

        {/* Logo & Desktop Nav */}
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <h1 className="text-xl font-black italic tracking-tighter text-primary">EZD App</h1>
          </Link>

          {/* Desktop Navigation - Server-side user check, client-side active state */}
          {user && <NavLinks />}
        </div>

        {/* Development Tools */}
        {user && (
          <div className="flex items-center">
            <DevRoleToggle userId={user.id} />
          </div>
        )}
      </div>
    </header>
  );
}
