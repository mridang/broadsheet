'use client';

import type { ReactElement } from 'react';

import { unfollowFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/** "Remove" on a row of the feed manager. */
export function RemoveFeedButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <div>
      <button
        type="button"
        className={buttonClass({ variant: 'danger', size: 'sm' })}
        disabled={busy}
        onClick={() =>
          void run(() => unfollowFeed(id), 'Could not remove that feed.')
        }
      >
        Remove
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
