'use client';

import { useRouter } from "next/navigation";
import { ReactNode } from "react";

export function ClickableCard({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
    const router = useRouter();

    return (
        <div
            onClick={() => router.push(href)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(href);
                }
            }}
            role="link"
            tabIndex={0}
            className={className}
        >
            {children}
        </div>
    );
}
