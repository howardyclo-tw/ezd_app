'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, Crown, User as UserIcon, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/components/providers/role-provider';

const navItems = [
  { href: '/dashboard', label: '個人中心' },
  { href: '/courses', label: '課程檔期', icon: Calendar },
];

export function MobileNav() {
  const pathname = usePathname();
  const { role } = useUserRole();

  const isLeaderOrAdmin = role === 'admin' || role === 'leader';

  const getIcon = (item: any) => {
    if (item.icon) return item.icon;
    if (item.href === '/dashboard') return LayoutDashboard;
    return LayoutDashboard;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden shadow-[0_-1px_10px_rgba(0,0,0,0.05)]">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const Icon = getIcon(item);
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
