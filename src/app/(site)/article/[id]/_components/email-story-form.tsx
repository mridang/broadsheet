'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { problemError } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';

/** The body a filled-in email form posts. */
export function emailRequest(form: FormData): {
  readonly to: string;
  readonly comment?: string;
  readonly copy_me: boolean;
} {
  const comment = String(form.get('comment') ?? '').trim();
  return {
    to: String(form.get('to') ?? ''),
    ...(comment ? { comment } : {}),
    copy_me: form.get('copy_me') === 'on',
  };
}

/**
 * Email the story to other people (`POST /api/articles/:id/emails`). While
 * the server has no email set up (503) it opens the reader's own mail app
 * with the story filled in instead.
 */
export function EmailStoryForm({
  articleId,
  mailto,
}: Readonly<{ articleId: number; mailto: string }>): ReactElement {
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useApiAction(() => setSent(true));
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const body = emailRequest(new FormData(event.currentTarget));
    void run(async () => {
      const res = await fetch(`/api/articles/${articleId}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 503) {
        window.location.href = mailto;
        return;
      }
      if (!res.ok) throw await problemError(res);
    }, 'Could not send that email.');
  };
  return (
    <details>
      <summary>Email this story</summary>
      {sent ? (
        <p>Sent.</p>
      ) : (
        <form onSubmit={submit}>
          <input
            name="to"
            type="text"
            placeholder="Addresses, separated by commas"
            aria-label="Who to send it to"
            required
          />
          <textarea name="comment" maxLength={2048} aria-label="A note" />
          <label>
            <input name="copy_me" type="checkbox" defaultChecked /> Send me a
            copy
          </label>
          <button className="btn" type="submit" disabled={busy}>
            Send
          </button>
          <a href={mailto}>Use my own mail app</a>
        </form>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
