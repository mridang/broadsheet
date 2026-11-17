'use client';

import { useState } from 'react';

import { z } from 'zod';
import { useApiAction } from '@/components/api/use-api-action';
import { addToken } from '@/app/(site)/settings/_components/settings-requests';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';
import type { TokenRequest } from '@/app/(site)/settings/_components/settings-requests';
import type { ReactElement, SubmitEvent } from 'react';

/** The fields the token form posts. */
const tokenForm = z.object({
  feed: z.string().default('saves'),
  filter: z.string().default('all'),
  tag: z.string().default(''),
});

/** The request a filled-in token form makes. */
export function tokenRequest(form: FormData): TokenRequest {
  const fields = tokenForm.parse(Object.fromEntries(form));
  const choice = fields.feed;
  const filter = fields.filter;
  const filtered = filter === 'all' ? {} : { filter };
  if (choice.startsWith('section:')) {
    return {
      scope: 'section',
      section_id: choice.slice('section:'.length),
      ...filtered,
    };
  }
  if (choice === 'edition') {
    return { scope: 'edition', ...filtered };
  }
  if (choice === 'highlights') {
    return { scope: 'highlights' };
  }
  const tag = fields.tag.trim();
  return tag ? { scope: 'saves', tag } : { scope: 'saves' };
}

/** The box for making a private feed address; shows the address once it is made. */
export function AddTokenForm({
  sections,
}: Readonly<{
  sections: readonly { id: number; name: string }[];
}>): ReactElement {
  const [address, setAddress] = useState<string | undefined>();
  const { busy, error, run } = useApiAction();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const request = tokenRequest(new FormData(event.currentTarget));
    void run(
      async () => setAddress(await addToken(request)),
      'Could not make that feed.',
    );
  };
  if (address) {
    return (
      <div>
        <p className="text-sm text-muted">
          Add this address to your feed reader. It is shown only now, and anyone
          with it can read the feed:{' '}
          <code className="mt-2 block rounded-control bg-ink/5 px-3 py-2 font-mono text-xs wrap-anywhere">
            {address}
          </code>
        </p>
        <button
          type="button"
          // eslint-disable-next-line unicorn/no-keyword-prefix -- className is the React DOM prop name, fixed by the JSX API
          className={buttonClass({ className: 'mt-3' })}
          onClick={() => globalThis.location.reload()}
        >
          Done
        </button>
      </div>
    );
  }
  return (
    <>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={submit}
      >
        <select
          name="feed"
          defaultValue="saves"
          aria-label="What the feed shows"
        >
          <option value="saves">Saved stories</option>
          <option value="highlights">Highlights</option>
          <option value="edition">The whole edition</option>
          {sections.map((s) => (
            <option key={s.id} value={`section:${s.id}`}>
              Section: {s.name}
            </option>
          ))}
        </select>
        <select
          name="filter"
          defaultValue="all"
          aria-label="Which stories a section or edition feed keeps"
        >
          <option value="all">Every story</option>
          <option value="unread">Leave out disliked stories</option>
          <option value="focus">Only liked stories</option>
        </select>
        <input
          aria-label="Only this tag"
          name="tag"
          type="text"
          placeholder="Only this tag (saved stories)"
          maxLength={50}
          className="w-full sm:flex-1"
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Make feed
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
