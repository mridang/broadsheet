'use client';

import type { ReactElement } from 'react';

import { refreshFeeds } from './feed-requests';
import { useFeedAction } from './use-feed-action';

/** "Refresh now": fetch every followed feed again. */
export function RefreshFeedsButton(): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <>
      <button
        type="button"
        className="btn ghost small"
        disabled={busy}
        onClick={() => void run(refreshFeeds, 'Could not refresh the feeds.')}
      >
        Refresh now
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </>
  );
}
