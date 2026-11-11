import type { ReactElement } from 'react';

import { TextLink } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

/** One tab: its words, where it goes, and whether it is the one open. */
export interface Tab {
  readonly label: string;
  readonly href: string;
  readonly current?: boolean;
  /** A count shown beside the words. */
  readonly count?: number;
}

/**
 * A row of tabs that each go to an address (so the open tab survives a reload
 * and can be linked to), underlined where the page is. It scrolls sideways on
 * a phone rather than wrapping.
 */
export function Tabs({
  label,
  tabs,
  className,
}: Readonly<{
  /** What the tabs choose between, for a screen reader. */
  label: string;
  tabs: readonly Tab[];
  className?: string;
}>): ReactElement {
  return (
    <nav
      aria-label={label}
      className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}
    >
      <ul className="flex min-w-max gap-6 border-b border-line">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <TextLink
              bare
              href={tab.href}
              aria-current={tab.current ? 'page' : undefined}
              className={cn(
                'focus-ring -mb-px inline-flex h-10 items-center gap-2 border-b-2 text-sm font-medium transition-colors',
                tab.current
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:border-line hover:text-ink',
              )}
            >
              {tab.label}
              {tab.count === undefined ? null : (
                <span className="text-xs text-subtle tabular-nums">
                  {tab.count}
                </span>
              )}
            </TextLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
