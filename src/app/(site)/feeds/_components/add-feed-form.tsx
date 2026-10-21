'use client';

import type { FormEvent, ReactElement } from 'react';

import { followFeed } from './feed-requests';
import { useFeedAction } from './use-feed-action';

/** The box at the top of the feed manager for following another feed. */
export function AddFeedForm(): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('url') ?? '');
    void run(() => followFeed(url), 'Could not add that feed.');
  };
  return (
    <>
      <form className="addform" onSubmit={submit}>
        <input
          name="url"
          type="url"
          placeholder="https://example.com/feed.xml"
          required
        />
        <button className="btn" type="submit" disabled={busy}>
          Add
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
