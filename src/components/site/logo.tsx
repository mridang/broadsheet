import type { ReactElement } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * The app's mark: a broadsheet page with its corner folded, a masthead across
 * the top and the front page set in columns, on a tile of the brand colour.
 * It is drawn on a 32-unit grid with whole-unit edges, so it stays crisp at
 * 16px (`src/app/icon.svg` and the PNG icons are the same drawing). Size it
 * with a class (`size-7`); the tile and the lead column take the brand colour
 * unless a class sets another, and the page stays newsprint in either theme.
 */
export function BrandMark({
  className,
}: Readonly<{ className?: string }>): ReactElement {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn('shrink-0 text-brand', className)}
    >
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <path d="M8 5h12l5 5v17H8z" fill="#faf6ee" />
      <path d="M20 5v5h5z" fill="#d9cfbd" />
      <rect x="10.5" y="8" width="7" height="3" rx=".5" fill="#1c1a17" />
      <rect x="10.5" y="13.5" width="5" height="11" rx=".5" fill="#1c1a17" />
      <rect
        x="17.5"
        y="13.5"
        width="5"
        height="4.5"
        rx=".5"
        fill="currentColor"
      />
      <rect x="17.5" y="20" width="5" height="4.5" rx=".5" fill="#1c1a17" />
    </svg>
  );
}

/** The mark and the name set in the serif, as the masthead of the top bar. */
export function Wordmark({
  name,
  className,
}: Readonly<{ name: string; className?: string }>): ReactElement {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark className="size-7" />
      <span className="font-serif text-xl font-bold tracking-tight text-ink">
        {name}
      </span>
    </span>
  );
}
