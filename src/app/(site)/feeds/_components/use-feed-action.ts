'use client';

import { useState } from 'react';

import { problemText } from '@/lib/problem-message';

/** What a feed control shows while its request runs and after it fails. */
export interface FeedAction {
  readonly busy: boolean;
  /** The sentence to show the person, or undefined when nothing went wrong. */
  readonly error: string | undefined;
  /** Run the request; reload the page (to show what changed) when it succeeds. */
  readonly run: (
    request: () => Promise<void>,
    failure: string,
  ) => Promise<void>;
}

/** Shared behaviour of the controls on the feed manager. */
export function useFeedAction(): FeedAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const run: FeedAction['run'] = async (request, failure) => {
    setBusy(true);
    setError(undefined);
    try {
      await request();
      window.location.reload();
    } catch (err) {
      setError(problemText(err, failure));
      setBusy(false);
    }
  };
  return { busy, error, run };
}
