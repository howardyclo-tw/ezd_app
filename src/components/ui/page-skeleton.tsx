/**
 * Reusable skeleton building blocks for page loading states.
 * Used in loading.tsx files across all routes.
 */

import { cn } from '@/lib/utils';

// ─── Base Atom ─────────────────────────────────────────────────────────────
export function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-muted/60 animate-pulse',
        className
      )}
    />
  );
}

// ─── Page Header (back button + icon + title/subtitle) ─────────────────────
export function PageHeaderSkeleton() {
  return (
    <div className="flex items-center gap-1 -ml-2">
      <Bone className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex items-center gap-3">
        <Bone className="h-10 w-10 rounded-xl shrink-0" />
        <div className="space-y-1.5">
          <Bone className="h-6 w-32" />
          <Bone className="h-3.5 w-52" />
        </div>
      </div>
    </div>
  );
}

// ─── Small card-like list row ───────────────────────────────────────────────
export function ListRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-4 p-4 rounded-2xl border border-muted/50 bg-card/50', className)}>
      <Bone className="h-10 w-10 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Bone className="h-4 w-32" />
        <Bone className="h-3 w-52" />
      </div>
      <Bone className="h-6 w-6 rounded-full shrink-0" />
    </div>
  );
}

// ─── Generic card ──────────────────────────────────────────────────────────
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-muted/50 bg-card/50 p-5 space-y-3', className)}>
      <div className="space-y-2">
        <Bone className="h-3 w-20" />
        <Bone className="h-5 w-40" />
      </div>
      <div className="space-y-1.5">
        <Bone className="h-3.5 w-full" />
        <Bone className="h-3.5 w-4/5" />
        <Bone className="h-3.5 w-3/5" />
      </div>
    </div>
  );
}

// ─── Tab bar ───────────────────────────────────────────────────────────────
export function TabBarSkeleton({ tabs = 3 }: { tabs?: number }) {
  return (
    <div className="flex gap-1 border-b border-muted/40 pb-0">
      {Array.from({ length: tabs }).map((_, i) => (
        <Bone key={i} className="h-9 w-24 rounded-t-md rounded-b-none" />
      ))}
    </div>
  );
}
