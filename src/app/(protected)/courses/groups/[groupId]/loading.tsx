import { Bone, CardSkeleton } from '@/components/ui/page-skeleton';

export default function CourseGroupLoading() {
  return (
    <div className="container max-w-5xl py-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-2">
          <Bone className="h-9 w-9 rounded-full shrink-0 -ml-2" />
          <div className="space-y-2">
            <Bone className="h-7 w-48" />
            <Bone className="h-4 w-36" />
          </div>
        </div>
        <Bone className="h-10 w-36 rounded-xl shrink-0" />
      </div>

      {/* Course cards grid */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
