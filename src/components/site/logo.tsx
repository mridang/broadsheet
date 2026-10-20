import type { ReactElement } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * The app's mark: an upvote triangle, the Hacker News arrow. It illustrates the
 * not-found and error pages; size it with a class (`size-14`), and it takes the
 * brand colour unless a class sets another.
 */
export function BrandMark({
  className,
}: Readonly<{ className?: string }>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn('text-brand', className)}
    >
      <path d="M12 3.5 21.5 20h-19z" />
    </svg>
  );
}
