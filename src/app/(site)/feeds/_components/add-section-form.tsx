'use client';

import type { FormEvent, ReactElement } from 'react';

import { addSection } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';

/** The box on the feed manager for adding a section to file feeds under. */
export function AddSectionForm(): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name') ?? '');
    void run(() => addSection(name), 'Could not add that section.');
  };
  return (
    <>
      <form className="addform" onSubmit={submit}>
        <input
          name="name"
          type="text"
          placeholder="New section"
          maxLength={200}
          required
        />
        <button className="btn" type="submit" disabled={busy}>
          Add section
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
