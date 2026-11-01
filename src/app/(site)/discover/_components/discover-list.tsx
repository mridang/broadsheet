import type { ReactElement } from 'react';

import { FollowButton } from '@/app/(site)/discover/_components/follow-button';
import { hostOf } from '@/domain/render/tiers';
import { List } from '@/components/ui/card';

/** A feed Discover found, ready to show: its picture is already a served address. */
export interface DiscoveredFeed {
  readonly url: string;
  readonly title?: string | null;
  /** A line about it: an author, a description. */
  readonly detail?: string;
  /** Short facts: followers, episodes, a genre. */
  readonly meta?: readonly string[];
  readonly picture?: string | null;
  /** Where people can see it, when that is not the feed itself. */
  readonly link?: string;
  readonly followed?: boolean;
}

/** One found feed with its "Follow" button. */
function DiscoverRow({
  feed,
}: Readonly<{ feed: DiscoveredFeed }>): ReactElement {
  const meta = (feed.meta ?? []).filter(Boolean).join(' · ');
  return (
    <li className="flex items-start gap-4 px-4 py-3.5 sm:px-5">
      {feed.picture ? (
        <img
          className="size-12 shrink-0 rounded-control bg-ink/5 object-cover"
          loading="lazy"
          src={feed.picture}
          alt=""
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <strong className="text-sm font-medium text-ink">
          {feed.link ? (
            <a
              className="focus-ring rounded-sm underline-offset-4 hover:underline"
              href={feed.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {feed.title || hostOf(feed.url)}
            </a>
          ) : (
            feed.title || hostOf(feed.url)
          )}
        </strong>
        <div className="truncate text-xs text-subtle">{feed.url}</div>
        {feed.detail ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted">{feed.detail}</p>
        ) : null}
        {meta ? <div className="mt-1 text-xs text-muted">{meta}</div> : null}
      </div>
      <FollowButton url={feed.url} followed={feed.followed ?? false} />
    </li>
  );
}

/** The feeds Discover found, each with a "Follow" button. */
export function DiscoverList({
  feeds,
}: Readonly<{ feeds: readonly DiscoveredFeed[] }>): ReactElement {
  return (
    <List>
      {feeds.map((feed) => (
        <DiscoverRow key={feed.url} feed={feed} />
      ))}
    </List>
  );
}
