'use client';

import { useState } from 'react';
import { z } from 'zod';
import { ROW_LINK } from '@/components/stories/story-row';

import { problemError } from '@/components/api/problem-message';
import { useApiAction } from '@/components/api/use-api-action';
import { Button, TextLink } from '@/components/ui/button';
import { CARD, CHECK_LABEL } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import type { SubmitEvent, ReactElement } from 'react';

/** The fields the email form posts. */
const emailForm = z.object({
  comment: z.string().default(''),
  from_name: z.string().default(''),
  to: z.string().default(''),
});

/** The body a filled-in email form posts. */
export function emailRequest(form: FormData) {
  const fields = emailForm.parse(Object.fromEntries(form));
  const comment = fields.comment.trim();
  const name = fields.from_name.trim();
  return {
    to: fields.to,
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
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const body = emailRequest(new FormData(event.currentTarget));
    void run(async () => {
      const res = await fetch(`/api/articles/${articleId}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 503) {
        globalThis.location.assign(mailto);
        return;
      }
      if (!res.ok) {
        throw await problemError(res);
      }
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
            <input
              aria-label="Send me a copy"
              name="copy_me"
              type="checkbox"
              defaultChecked
            />{' '}
            Send me a copy
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
