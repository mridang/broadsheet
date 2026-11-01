'use client';

import type { FormEvent, ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  setNotification,
  type NotificationRequest,
} from '@/app/(site)/settings/_components/settings-requests';

/** The request a filled-in notification form makes. */
export function notificationRequest(form: FormData): NotificationRequest {
  return {
    filter: String(form.get('filter') ?? 'unread'),
    channels: form.getAll('channels').map(String),
  };
}

/** How one feed tells the person about new stories. */
export function FeedNotificationForm({
  feedId,
  title,
  filter,
  channels,
}: Readonly<{
  feedId: number;
  title: string;
  filter: string;
  channels: readonly string[];
}>): ReactElement {
  const { busy, error, run } = useApiAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const request = notificationRequest(new FormData(event.currentTarget));
    void run(
      () => setNotification(feedId, request),
      'Could not save those notifications.',
    );
  };
  return (
    <form className="feedrow" onSubmit={submit}>
      <strong>{title}</strong>
      <select
        name="filter"
        defaultValue={filter}
        aria-label={`Which new stories in ${title} notify you`}
      >
        <option value="unread">Any story not disliked</option>
        <option value="focus">Only liked stories</option>
      </select>
      {(['web', 'email', 'webhook'] as const).map((channel) => (
        <label key={channel}>
          <input
            name="channels"
            type="checkbox"
            value={channel}
            defaultChecked={channels.includes(channel)}
          />{' '}
          {channel === 'web'
            ? 'Push'
            : channel === 'email'
              ? 'Email'
              : 'Webhook'}
        </label>
      ))}
      <button className="btn" type="submit" disabled={busy}>
        Save
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
