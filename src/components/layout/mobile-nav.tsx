'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/components/providers/role-provider';

const navItems = [
  { href: '/dashboard', label: '幹部後台', icon: ShieldCheck, roles: ['admin', 'leader'] },
  { href: '/courses', label: '課程檔期', icon: Calendar },
];

export function MobileNav() {
  const pathname = usePathname();
  const { role } = useUserRole();

  // Hide navigation on specific form pages if needed, otherwise show if logged in (role !== guest)
  const isFormPage = pathname?.includes('/courses/new') || pathname?.includes('/courses/edit');

  // If role is guest, it means user is not logged in or just a visitor, so we might hide nav or show only guest items. 
  // Adjusted logic: Show nav if role is present (even guest might see public pages, but usually we hide for non-login).
  // Assuming 'guest' means NOT logged in based on previous logic.
  if (role === 'guest' || isFormPage) {
    return null;
  }

  const filteredItems = navItems.filter(item => {
    if (!item.roles) return true;
    return role && item.roles.includes(role);
  });

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden shadow-[0_-1px_10px_rgba(0,0,0,0.05)]">
      <div className="flex h-16 items-center justify-around">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all duration-200',
                isActive
                  ? 'text-primary font-bold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5px]")} />
              <span className="text-[10px] uppercase font-bold tracking-wider">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
