'use client';

import type { ReactElement } from 'react';

import { followFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { hostOf } from '@/domain/render/tiers';

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
    <div className="feedrow">
      <div>
        <strong>{feed.title || hostOf(feed.url)}</strong>
        <div className="u">{feed.url}</div>
        <div className="muted">
          Followed by {feed.followers} reader{feed.followers === 1 ? '' : 's'}{' '}
          like you
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() =>
          void run(() => followFeed(feed.url), 'Could not follow that feed.')
        }
      >
        Follow
      </button>
    </div>
  );
}

/** "You might also like": sources other readers follow alongside yours. */
export function SuggestedFeeds({
  feeds,
}: Readonly<{ feeds: readonly SuggestedFeed[] }>): ReactElement | null {
  if (!feeds.length) return null;
  return (
    <>
      <h2>You might also like</h2>
      {feeds.map((feed) => (
        <SuggestionRow key={feed.url} feed={feed} />
      ))}
    </>
  );
}
