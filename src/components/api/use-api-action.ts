'use client';

import { useState } from 'react';

import { problemText } from './problem-message';

/** What a control driven by an API request shows while it runs and after it fails. */
export interface ApiAction {
  readonly busy: boolean;
  /** The sentence to show the person, or undefined when nothing went wrong. */
  readonly error: string | undefined;
  /**
   * Run `request`; on failure show the server's words (or `failure` for a
   * network error). `request` throws for a refused response (see `ensureOk`).
   */
  readonly run: (
    request: () => Promise<void>,
    failure: string,
  ) => Promise<void>;
}

/**
 * The shared behaviour of a control backed by one API call: a busy flag, the
 * error sentence, and a `run` that wires them. `onSuccess` runs after the
 * request resolves (e.g. reload the page to show what changed); on failure the
 * error is shown and the control is no longer busy.
 */
export function useApiAction(onSuccess?: () => void): ApiAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const run: ApiAction['run'] = async (request, failure) => {
    setBusy(true);
    setError(undefined);
    try {
      await request();
      onSuccess?.();
    } catch (err) {
      setError(problemText(err, failure));
      setBusy(false);
    }
  };
  return { busy, error, run };
}
