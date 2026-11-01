import type { ReactElement } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * A grey block that stands in for content while it loads. Give it a size;
 * it pulses gently (still, for people who ask for less motion).
 */
export function Skeleton({
  className,
}: Readonly<{ className?: string }>): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn('block animate-pulse rounded-control bg-ink/6', className)}
    />
  );
}

/** A stand-in for a list of story rows while they load. */
export function SkeletonRows({
  rows = 4,
}: Readonly<{ rows?: number }>): ReactElement {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-3.5 w-full" />
          </div>
          <Skeleton className="hidden h-20 w-28 rounded-card sm:block" />
        </div>
      ))}
    </div>
  );
}
