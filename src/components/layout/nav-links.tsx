'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Calendar, Crown, User as UserIcon } from 'lucide-react';

interface NavItem {
    href: string;
    label: string;
    icon?: any;
}

const navItems: NavItem[] = [
    { href: '/dashboard', label: '個人中心' },
    { href: '/courses', label: '課程檔期', icon: Calendar },
];

import { useUserRole } from '@/components/providers/role-provider';

export function NavLinks() {
    const pathname = usePathname();
    const { role } = useUserRole();

    const getIcon = (item: NavItem) => {
        if (item.icon) return item.icon;
        if (item.href === '/dashboard') return LayoutDashboard;
        return LayoutDashboard;
    };

    return (
        <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
                const Icon = getIcon(item);
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-bold transition-all duration-200",
                            isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-primary hover:bg-primary/5"
                        )}
                    >
                        <Icon className="h-4 w-4" />
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
