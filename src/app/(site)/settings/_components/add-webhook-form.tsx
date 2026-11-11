'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { addWebhook } from '@/app/(site)/settings/_components/settings-requests';
import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/** The box for adding a webhook; shows the signing secret once it is made. */
export function AddWebhookForm(): ReactElement {
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const { busy, error, run } = useApiAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = String(form.get('url') ?? '');
    const events = form.getAll('events').map(String);
    void run(
      async () => setSecret(await addWebhook(url, events)),
      'Could not add that webhook.',
    );
  };
  if (secret) {
    return (
      <div>
        <p className="text-sm text-muted">
          Webhook added. Deliveries are signed with this secret, shown only now:{' '}
          <code className="mt-2 block rounded-control bg-ink/5 px-3 py-2 font-mono text-xs wrap-anywhere">
            {secret}
          </code>
        </p>
        <button
          type="button"
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
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            name="url"
            type="url"
            aria-label="Webhook address"
            placeholder="https://example.com/hook"
            required
            className="w-full sm:flex-1"
          />
          <button className={buttonClass({})} type="submit" disabled={busy}>
            Add webhook
          </button>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className={CHECK_LABEL}>
            <input name="events" type="checkbox" value="save" defaultChecked />{' '}
            Saves
          </label>
          <label className={CHECK_LABEL}>
            <input name="events" type="checkbox" value="like" defaultChecked />{' '}
            Likes
          </label>
          <label className={CHECK_LABEL}>
            <input name="events" type="checkbox" value="story" /> New stories in
            notifying feeds
          </label>
        </div>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
