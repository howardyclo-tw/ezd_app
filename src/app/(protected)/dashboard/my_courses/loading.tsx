import { Bone, PageHeaderSkeleton, TabBarSkeleton } from '@/components/ui/page-skeleton';

export default function MyCoursesLoading() {
  return (
    <div className="container max-w-5xl py-6 space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <PageHeaderSkeleton />
      </div>

      <TabBarSkeleton tabs={3} />

      <div className="space-y-3 pt-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-muted/50 bg-card/50 p-4 flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <Bone className="h-3 w-16" />
              <Bone className="h-4 w-36" />
              <Bone className="h-3 w-52" />
            </div>
            <Bone className="h-7 w-16 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
