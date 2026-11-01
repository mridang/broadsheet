'use client';

import type { ReactElement } from 'react';

import { followFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { hostOf } from '@/domain/render/tiers';
import { buttonClass } from '@/components/ui/button';
import { CARD } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { PageSection } from '@/components/ui/page-header';

/** A source trending across the app, as the feed manager lists it. */
export interface TrendingFeed {
  readonly url: string;
  readonly title: string | null;
  readonly readers: number;
}

/** One trending source with its "Follow" button. */
function TrendingRow({ feed }: Readonly<{ feed: TrendingFeed }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <strong className="text-sm font-semibold">
          {feed.title || hostOf(feed.url)}
        </strong>
        <div className="truncate text-xs text-subtle">{feed.url}</div>
        <div className="mt-1 text-xs text-muted">
          Read by {feed.readers} reader{feed.readers === 1 ? '' : 's'} this week
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>
      <button
        type="button"
        className={buttonClass({ size: 'sm' })}
        disabled={busy}
        onClick={() =>
          void run(() => followFeed(feed.url), 'Could not follow that feed.')
        }
      >
        Follow
      </button>
    </li>
  );
}

/** "Trending feeds": the sources most read across the app this week. */
export function TrendingFeeds({
  feeds,
}: Readonly<{ feeds: readonly TrendingFeed[] }>): ReactElement | null {
  if (!feeds.length) return null;
  return (
    <PageSection id="trending" title="Trending feeds">
      <ul className={`${CARD} divide-y divide-line`}>
        {feeds.map((feed) => (
          <TrendingRow key={feed.url} feed={feed} />
        ))}
      </ul>
    </PageSection>
  );
}
