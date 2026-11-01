'use client';

import type { FormEvent, ReactElement } from 'react';

import { followFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

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
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={submit}
      >
        <input
          name="url"
          type="url"
          placeholder="https://example.com/feed.xml"
          aria-label="Feed address"
          className="w-full sm:flex-1"
          required
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Add feed
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
