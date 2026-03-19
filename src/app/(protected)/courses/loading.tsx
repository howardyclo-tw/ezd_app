import { Bone, CardSkeleton } from '@/components/ui/page-skeleton';

export default function CoursesLoading() {
  return (
    <div className="container max-w-4xl py-10 space-y-6">
      {/* Title */}
      <div className="space-y-1.5 mb-10 text-center">
        <Bone className="h-7 w-24 mx-auto" />
        <Bone className="h-4 w-56 mx-auto" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 justify-center">
        {[1, 2, 3].map((i) => (
          <Bone key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>

      {/* Course group cards */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <CardSkeleton key={i} className="p-6" />
        ))}
      </div>
    </div>
  );
}
