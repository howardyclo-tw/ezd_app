'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ShieldCheck, Calendar } from 'lucide-react';

interface NavItem {
    href: string;
    label: string;
    icon: any;
    roles?: string[]; // roles that can see this item
}

const navItems: NavItem[] = [
    { href: '/dashboard', label: '幹部後台', icon: ShieldCheck, roles: ['admin', 'leader'] },
    { href: '/courses', label: '課程', icon: Calendar }, // Changed href to /courses
];

import { useUserRole } from '@/components/providers/role-provider';

export function NavLinks() {
    const pathname = usePathname();
    const { role } = useUserRole();

    // Filter items based on user role
    const filteredItems = navItems.filter(item => {
        if (!item.roles) return true;
        return role && item.roles.includes(role);
    });

    return (
        <nav className="hidden md:flex items-center gap-1">
            {filteredItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-bold transition-all duration-200",
                            isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
