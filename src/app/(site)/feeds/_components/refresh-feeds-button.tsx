'use client';

import type { ReactElement } from 'react';

import { refreshFeeds } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';

/** "Refresh now": fetch every followed feed again. */
export function RefreshFeedsButton(): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <>
      <button
        type="button"
        className={buttonClass({
          variant: 'outline',
          size: 'sm',
          className: 'border-line',
        })}
        disabled={busy}
        onClick={() => void run(refreshFeeds, 'Could not refresh the feeds.')}
      >
        Refresh now
      </button>
      {error ? (
        <span role="alert" className="text-sm text-red-700 dark:text-red-400">
          {' '}
          {error}
        </span>
      ) : null}
    </>
  );
}
