import { Bone, PageHeaderSkeleton } from '@/components/ui/page-skeleton';

export default function MembersLoading() {
  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div className="flex items-center gap-1 -ml-2">
        <PageHeaderSkeleton />
      </div>

      {/* Search bar */}
      <Bone className="h-10 w-full rounded-xl" />

      {/* Member rows */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="flex items-center gap-4 p-3 rounded-xl border border-muted/40 bg-card/40">
            <Bone className="h-9 w-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-28" />
              <Bone className="h-3 w-44" />
            </div>
            <Bone className="h-6 w-14 rounded-full shrink-0" />
            <Bone className="h-8 w-8 rounded-lg shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
