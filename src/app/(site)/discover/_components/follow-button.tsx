'use client';

import type { ReactElement } from 'react';

import { followFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/**
 * "Follow" on a feed found by Discover: follows it (`POST /api/feeds`) and
 * reloads the page, so it shows as followed. A feed already followed shows
 * that instead.
 */
export function FollowButton({
  url,
  followed = false,
}: Readonly<{ url: string; followed?: boolean }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        className={buttonClass({
          variant: followed ? 'outline' : 'primary',
          size: 'sm',
        })}
        disabled={busy || followed}
        onClick={() =>
          void run(() => followFeed(url), 'Could not follow that feed.')
        }
      >
        {followed ? 'Following' : 'Follow'}
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
