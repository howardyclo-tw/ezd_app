import { Bone } from '@/components/ui/page-skeleton';

export default function SettingsLoading() {
  return (
    <div className="container max-w-5xl py-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Bone className="h-7 w-32" />
        <Bone className="h-4 w-64" />
      </div>

      {/* Config rows */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-xl border border-muted/50 bg-card/50 p-4 flex items-center justify-between gap-4">
            <div className="space-y-1.5">
              <Bone className="h-4 w-32" />
              <Bone className="h-3 w-56" />
            </div>
            <Bone className="h-9 w-36 rounded-lg shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
