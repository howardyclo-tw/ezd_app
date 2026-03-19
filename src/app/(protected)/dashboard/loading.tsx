import { Bone, ListRowSkeleton } from '@/components/ui/page-skeleton';

export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10 pb-24">
      {/* User info bar */}
      <div className="flex flex-col items-center">
        <Bone className="h-9 w-72 rounded-2xl" />
      </div>

      {/* Nav cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-muted/50 bg-card/50 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <Bone className="h-10 w-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-24" />
                <Bone className="h-3 w-40" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              {[1, 2].map((j) => (
                <div key={j} className="rounded-xl bg-muted/30 p-3 space-y-1.5">
                  <Bone className="h-3 w-16" />
                  <Bone className="h-5 w-10" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Admin tools section */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-muted" />
          <Bone className="h-3 w-24" />
          <div className="h-px flex-1 bg-muted" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <ListRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
