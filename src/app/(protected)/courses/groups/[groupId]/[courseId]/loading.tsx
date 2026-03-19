import { Bone } from '@/components/ui/page-skeleton';

export default function CourseDetailLoading() {
  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-4 py-4 space-y-6">
      {/* Metadata card */}
      <div className="rounded-2xl border border-muted/50 bg-card/50 p-5 space-y-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <Bone className="h-3 w-20" />
            <Bone className="h-7 w-64" />
          </div>
          <Bone className="h-7 w-20 rounded-full shrink-0" />
        </div>

        {/* Meta rows */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="rounded-xl bg-muted/20 p-3 space-y-1.5">
              <Bone className="h-3 w-12" />
              <Bone className="h-4 w-20" />
            </div>
          ))}
        </div>

        {/* Enrollment button */}
        <Bone className="h-11 w-full rounded-xl" />
      </div>

      {/* Sessions / Roster skeleton */}
      <div className="rounded-2xl border border-muted/50 bg-card/50 overflow-hidden">
        {/* Tab header */}
        <div className="flex border-b border-muted/40 px-4 pt-4 gap-1">
          {[1, 2].map((i) => (
            <Bone key={i} className="h-9 w-20 rounded-t-md rounded-b-none" />
          ))}
        </div>
        {/* Table rows */}
        <div className="p-4 space-y-2">
          {/* Header row */}
          <div className="flex gap-3 pb-2 border-b border-muted/30">
            {[1, 2, 3, 4].map((i) => (
              <Bone key={i} className="h-3 flex-1" />
            ))}
          </div>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex gap-3 py-2">
              {[1, 2, 3, 4].map((j) => (
                <Bone key={j} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
