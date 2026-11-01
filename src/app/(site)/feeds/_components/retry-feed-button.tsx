'use client';

import type { ReactElement } from 'react';

import { retryFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';

/** "Retry now": fetch a broken feed again from a clean slate. */
export function RetryFeedButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
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
        onClick={() =>
          void run(() => retryFeed(id), 'Could not fetch that feed.')
        }
      >
        Retry now
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
