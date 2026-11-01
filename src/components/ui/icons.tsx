import type { ReactElement } from 'react';

import { cn } from '@/components/ui/cn';

/** The outline of each icon, drawn on a 24-unit grid with a 1.75 stroke. */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4-4',
  sparkle:
    'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8',
  editions: 'M4 5h16M4 12h16M4 19h10',
  rss: 'M5 19a1 1 0 1 0 0-.01M5 11a8 8 0 0 1 8 8M5 4a15 15 0 0 1 15 15',
  settings:
    'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  compass: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm3.5 5.5-2 5-5 2 2-5z',
  trending: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
  briefing:
    'M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 8h6m-6 4h6',
  share: 'M12 15V3m0 0L8 7m4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  external:
    'M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17l9-10',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chevron: 'M9 6l6 6-6 6',
  headphones:
    'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zm16 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  queue: 'M4 6h12M4 12h12M4 18h8m8-4v6m-3-3h6',
  pencil: 'M4 20h4L19 9l-4-4L4 16zm9-13 4 4',
  atom: 'M12 12h.01M3 12a9 3.5 0 1 0 18 0 9 3.5 0 1 0-18 0m13.5 7.8A9 3.5 60 1 0 7.5 4.2a9 3.5 60 1 0 9 15.6M7.5 19.8a9 3.5-60 1 0 9-15.6 9 3.5-60 1 0-9 15.6',
  rdf: 'M6 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm12 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm-6 12a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8.5 6h7M7.2 8.2l3.6 7.6m6-7.6-3.6 7.6',
} as const;

/** The names of the icons there are. */
export type IconName = keyof typeof PATHS;

/**
 * A line icon in the text's colour. It is decoration: whatever it stands for
 * must also be said in words beside it (or in the control's label). It is
 * `size-5`; a `className` replaces that, so give it a size of its own.
 */
export function Icon({
  name,
  className,
}: Readonly<{ name: IconName; className?: string }>): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className ?? 'size-5')}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
