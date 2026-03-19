import { Bone, PageHeaderSkeleton, TabBarSkeleton } from '@/components/ui/page-skeleton';

export default function ApprovalsLoading() {
  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div className="flex items-center gap-1 -ml-2">
        <PageHeaderSkeleton />
      </div>

      <TabBarSkeleton tabs={4} />

      <div className="space-y-3 pt-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl border border-muted/50 bg-card/50 p-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <Bone className="h-4 w-28" />
                <Bone className="h-3 w-48" />
              </div>
              <Bone className="h-7 w-16 rounded-full shrink-0" />
            </div>
            <div className="flex gap-2 pt-1">
              <Bone className="h-8 w-20 rounded-lg" />
              <Bone className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
