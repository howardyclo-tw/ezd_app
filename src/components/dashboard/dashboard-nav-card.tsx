

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronRight, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface DashboardNavCardProps {
    href: string;
    icon: LucideIcon;
    title: string;
    description: string;
    stats: {
        label: string;
        value: ReactNode;
    }[];
}

export function DashboardNavCard({
    href,
    icon: Icon,
    title,
    description,
    stats
}: DashboardNavCardProps) {
    return (
        <Link href={href} className="group block h-full">
            <Card className={cn(
                "h-full relative overflow-hidden transition-all duration-500 group/card",
                // Base Premium Mirror/Glass Effect
                "bg-gradient-to-b from-white/[0.06] to-transparent",
                "border border-white/[0.08] backdrop-blur-xl",
                "shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.1),0_8px_16px_-4px_rgba(0,0,0,0.4)]",
                // Hover Effects
                "hover:border-white/[0.15] hover:from-white/[0.1] hover:shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.15),0_8px_24px_-4px_rgba(0,0,0,0.6)]"
            )}>
                <CardContent className="p-0 flex items-stretch relative z-10">
                    <div className="flex-1 p-8 pr-6 space-y-8">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-5">
                                <div className={cn(
                                    "h-12 w-12 rounded-2xl flex items-center justify-center transition-all duration-300 shrink-0 shadow-sm",
                                    "bg-muted/30 text-foreground group-hover:bg-foreground group-hover:text-background"
                                )}>
                                    <Icon className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-xl font-black tracking-tight">{title}</h2>
                                    <p className="text-sm text-muted-foreground font-medium">{description}</p>
                                </div>
                            </div>
                        </div>

                        <div className="pt-6 border-t border-muted/40 flex items-center">
                            {stats.map((stat, index) => (
                                <div key={stat.label} className="flex items-center">
                                    <div className="space-y-1.5">
                                        <p className="text-[11px] text-muted-foreground font-bold uppercase tracking-[0.15em] leading-none">{stat.label}</p>
                                        <div className="text-2xl font-black flex items-baseline gap-1.5 text-foreground leading-none">
                                            {stat.value}
                                        </div>
                                    </div>
                                    {index < stats.length - 1 && (
                                        <div className="mx-8 sm:mx-10 h-10 w-[1px] bg-muted/40 transform -rotate-12" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="w-16 shrink-0 flex items-center justify-center">
                        <ChevronRight className={cn(
                            "h-6 w-6 transition-all duration-300 text-muted-foreground/30",
                            "group-hover:text-foreground group-hover:translate-x-1"
                        )} />
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
