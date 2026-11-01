import type { ReactElement } from 'react';

import type { User } from '@/domain/repository';

import { FeedRail, type RailFeed } from '@/components/feeds/feed-rail';
import { InstallButton } from '@/components/site/install-button';
import { SidebarLink } from '@/components/site/sidebar-link';
import { Icon, type IconName } from '@/components/ui/icons';

/** The app's places, as the sidebar lists them: where, what, and its icon. */
type Place = readonly [href: string, label: string, icon: IconName];

/** The places a signed-in reader has. */
const SIGNED_IN: readonly Place[] = [
  ['/', 'Front page', 'home'],
  ['/saved', 'Saved', 'bookmark'],
  ['/search', 'Search', 'search'],
  ['/assistant', 'Assistant', 'sparkle'],
  ['/editions', 'Editions', 'editions'],
  ['/feeds', 'Manage feeds', 'rss'],
  ['/settings', 'Settings', 'settings'],
];

/** The places a visitor has. */
const SIGNED_OUT: readonly Place[] = [
  ['/', 'Front page', 'home'],
  ['/search', 'Search', 'search'],
];

/**
 * The side of every app page: the places to go, then (once signed in) the
 * reader's feeds, then "Install app" where the browser offers it.
 */
export function AppSidebar({
  user,
  feeds,
}: Readonly<{
  user: User | null;
  feeds: readonly RailFeed[];
}>): ReactElement {
  return (
    <div className="space-y-8">
      <nav aria-label="Main">
        <ul className="space-y-0.5">
          {(user ? SIGNED_IN : SIGNED_OUT).map(([href, label, icon]) => (
            <li key={href}>
              <SidebarLink href={href}>
                <Icon name={icon} className="size-4.5" />
                {label}
              </SidebarLink>
            </li>
          ))}
        </ul>
      </nav>
      {user && feeds.length ? <FeedRail feeds={feeds} /> : null}
      <InstallButton />
    </div>
  );
}
