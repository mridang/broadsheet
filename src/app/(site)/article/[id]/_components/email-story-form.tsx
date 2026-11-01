'use client';

import { ROW_LINK } from '@/components/stories/story-row';
import { useState, type FormEvent, type ReactElement } from 'react';

import { problemError } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';
import { Button, TextLink } from '@/components/ui/button';
import { CARD, CHECK_LABEL } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/** The body a filled-in email form posts. */
export function emailRequest(form: FormData): {
  readonly to: string;
  readonly comment?: string;
  readonly copy_me: boolean;
  readonly from_name?: string;
} {
  const comment = String(form.get('comment') ?? '').trim();
  const name = String(form.get('from_name') ?? '').trim();
  return {
    to: String(form.get('to') ?? ''),
    ...(comment ? { comment } : {}),
    ...(name ? { from_name: name } : {}),
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
    <details className="group">
      <summary
        className={`${ROW_LINK} list-none [&::-webkit-details-marker]:hidden`}
      >
        Email this story
      </summary>
      {sent ? (
        <p className="mt-3 text-sm text-muted">Sent.</p>
      ) : (
        <form
          className={`${CARD} mt-3 grid w-full gap-3 p-4 sm:w-96`}
          onSubmit={submit}
        >
          <input
            name="to"
            type="text"
            placeholder="Addresses, separated by commas"
            aria-label="Who to send it to"
            required
          />
          <input
            name="from_name"
            type="text"
            maxLength={200}
            placeholder="Your name"
            aria-label="The name to send it under"
          />
          <textarea
            name="comment"
            maxLength={2048}
            aria-label="A note"
            className="h-20"
          />
          <label className={CHECK_LABEL}>
            <input name="copy_me" type="checkbox" defaultChecked /> Send me a
            copy
          </label>
          <Button
            size="sm"
            className="justify-self-start"
            type="submit"
            disabled={busy}
          >
            Send
          </Button>
          <TextLink tone="muted" className="text-sm" href={mailto}>
            Use my own mail app
          </TextLink>
        </form>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </details>
  );
}
