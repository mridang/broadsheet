'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  addToken,
  type TokenRequest,
} from '@/app/(site)/settings/_components/settings-requests';
import { buttonClass } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/** The request a filled-in token form makes. */
export function tokenRequest(form: FormData): TokenRequest {
  const choice = String(form.get('feed') ?? 'saves');
  const filter = String(form.get('filter') ?? 'all');
  const filtered = filter === 'all' ? {} : { filter };
  if (choice.startsWith('section:')) {
    return {
      scope: 'section',
      section_id: choice.slice('section:'.length),
      ...filtered,
    };
  }
  if (choice === 'edition') return { scope: 'edition', ...filtered };
  const tag = String(form.get('tag') ?? '').trim();
  return tag ? { scope: 'saves', tag } : { scope: 'saves' };
}

/** The box for making a private feed address; shows the address once it is made. */
export function AddTokenForm({
  sections,
}: Readonly<{
  sections: readonly { id: number; name: string }[];
}>): ReactElement {
  const [address, setAddress] = useState<string | undefined>(undefined);
  const { busy, error, run } = useApiAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
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
          className={buttonClass({ className: 'mt-3' })}
          onClick={() => window.location.reload()}
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
          className={fieldClass()}
        >
          <option value="saves">Saved stories</option>
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
          className={fieldClass()}
        >
          <option value="all">Every story</option>
          <option value="unread">Leave out disliked stories</option>
          <option value="focus">Only liked stories</option>
        </select>
        <input
          name="tag"
          type="text"
          placeholder="Only this tag (saved stories)"
          maxLength={50}
          className={fieldClass('w-full sm:flex-1')}
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Make feed
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
