'use client';

import type { ReactElement } from 'react';

import { followFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { hostOf } from '@/domain/render/tiers';
import { buttonClass } from '@/components/ui/button';
import { List } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/notice';
import { PageSection } from '@/components/ui/page-header';

/** A source to suggest, as the feed manager lists it. */
export interface SuggestedFeed {
  readonly url: string;
  readonly title: string | null;
  readonly followers: number;
}

/** One suggestion with its "Follow" button. */
function SuggestionRow({
  feed,
}: Readonly<{ feed: SuggestedFeed }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <strong className="text-sm font-medium">
          {feed.title || hostOf(feed.url)}
        </strong>
        <div className="truncate text-xs text-subtle">{feed.url}</div>
        <div className="mt-1 text-xs text-muted">
          Followed by {feed.followers} reader{feed.followers === 1 ? '' : 's'}{' '}
          like you
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </div>
      <button
        type="button"
        className={buttonClass({ variant: 'outline', size: 'sm' })}
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

/** "You might also like": sources other readers follow alongside yours. */
export function SuggestedFeeds({
  feeds,
}: Readonly<{ feeds: readonly SuggestedFeed[] }>): ReactElement | null {
  if (!feeds.length) return null;
  return (
    <PageSection id="suggested" title="You might also like">
      <List>
        {feeds.map((feed) => (
          <SuggestionRow key={feed.url} feed={feed} />
        ))}
      </List>
    </PageSection>
  );
}
