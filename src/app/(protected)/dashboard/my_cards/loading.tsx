import { Bone } from '@/components/ui/page-skeleton';

export default function MyCardsLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Balance card */}
      <div className="rounded-2xl border border-muted/50 bg-card/50 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Bone className="h-5 w-24" />
          <Bone className="h-8 w-8 rounded-lg" />
        </div>
        <Bone className="h-12 w-32" />
        <Bone className="h-3 w-48" />
      </div>

      {/* Purchase button area */}
      <Bone className="h-12 w-full rounded-xl" />

      {/* Orders list */}
      <div className="space-y-3">
        <Bone className="h-5 w-20" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-muted/50 bg-card/50 p-4 space-y-2">
            <div className="flex justify-between">
              <Bone className="h-4 w-24" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
            <Bone className="h-3 w-40" />
            <Bone className="h-3 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
