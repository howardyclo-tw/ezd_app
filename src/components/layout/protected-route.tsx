import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/database';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole;
}

export async function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // If a specific role is required, check the user's profile
  if (requiredRole) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile) {
      redirect('/login');
    }

    // Check role hierarchy
    const roleHierarchy: Record<UserRole, number> = {
      guest: 0,
      member: 1,
      leader: 2,
      staff: 3,
    };

    if (roleHierarchy[profile.role as UserRole] < roleHierarchy[requiredRole]) {
      redirect('/dashboard');
    }
  }

  return <>{children}</>;
}

