'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { addWebhook } from '@/app/(site)/settings/_components/settings-requests';

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
        <p>
          Webhook added. Deliveries are signed with this secret, shown only now:{' '}
          <code>{secret}</code>
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => window.location.reload()}
        >
          Done
        </button>
      </div>
    );
  }
  return (
    <>
      <form className="addform" onSubmit={submit}>
        <input
          name="url"
          type="url"
          placeholder="https://example.com/hook"
          required
        />
        <label>
          <input name="events" type="checkbox" value="save" defaultChecked />{' '}
          Saves
        </label>
        <label>
          <input name="events" type="checkbox" value="like" defaultChecked />{' '}
          Likes
        </label>
        <button className="btn" type="submit" disabled={busy}>
          Add webhook
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
