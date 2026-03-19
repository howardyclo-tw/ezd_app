import { Bone, CardSkeleton, PageHeaderSkeleton } from '@/components/ui/page-skeleton';

export default function RollcallLoading() {
  return (
    <div className="container max-w-5xl py-6 space-y-6">
      <div className="flex items-center gap-1 -ml-2">
        <PageHeaderSkeleton />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-muted/50 bg-card/50 p-5 flex items-center justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="space-y-1.5">
                <Bone className="h-3 w-12" />
                <Bone className="h-5 w-48" />
              </div>
              <div className="space-y-1.5">
                <Bone className="h-3 w-32" />
                <Bone className="h-3 w-28" />
              </div>
            </div>
            <Bone className="h-10 w-10 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
