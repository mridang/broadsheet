import type { ReactElement } from 'react';

import { Tabs } from '@/components/ui/tabs';

/** The places to discover feeds, in the order the tabs show them. */
export const TABS = [
  ['sites', 'Trending sites'],
  ['picks', 'Recommended'],
  ['podcasts', 'Podcasts'],
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
    <Tabs
      label="Discover"
      className="mt-8"
      tabs={TABS.map(([id, label]) => ({
        label,
        href: `/discover?tab=${id}`,
        current: id === current,
      }))}
    />
  );
}
