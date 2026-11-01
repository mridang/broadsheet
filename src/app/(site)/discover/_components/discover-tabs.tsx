import Link from 'next/link';
import type { ReactElement } from 'react';

import { cn } from '@/components/ui/cn';

/** The places to discover feeds, in the order the tabs show them. */
export const TABS = [
  ['sites', 'Trending sites'],
  ['picks', 'Recommended'],
  ['podcasts', 'Podcasts'],
  ['reddit', 'Reddit'],
  ['news', 'Google News'],
] as const;

/** One of the Discover tabs. */
export type Tab = (typeof TABS)[number][0];

/** The tab a `tab` parameter names; trending sites when it names none. */
export function tabOf(raw: string | undefined): Tab {
  return TABS.find(([id]) => id === raw)?.[0] ?? 'sites';
}

/** The Discover tabs: links, so each is its own address. */
export function DiscoverTabs({
  current,
}: Readonly<{ current: Tab }>): ReactElement {
  return (
    <nav aria-label="Discover" className="mt-8 border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map(([id, label]) => (
          <li key={id}>
            <Link
              href={`/discover?tab=${id}`}
              aria-current={id === current ? 'page' : undefined}
              className={cn(
                'focus-ring-flush inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                id === current
                  ? 'border-ink text-ink'
                  : 'border-transparent text-subtle hover:text-ink',
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
