'use client';

import type { FormEvent, ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  setNotification,
  type NotificationRequest,
} from '@/app/(site)/settings/_components/settings-requests';
import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL, CHECKBOX, fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

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
    <form
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      onSubmit={submit}
    >
      <strong className="w-full truncate text-sm font-semibold sm:w-auto sm:flex-1">
        {title}
      </strong>
      <select
        name="filter"
        defaultValue={filter}
        aria-label={`Which new stories in ${title} notify you`}
        className={fieldClass('h-9')}
      >
        <option value="unread">Any story not disliked</option>
        <option value="focus">Only liked stories</option>
      </select>
      {(['web', 'email', 'webhook'] as const).map((channel) => (
        <label key={channel} className={CHECK_LABEL}>
          <input
            name="channels"
            type="checkbox"
            value={channel}
            defaultChecked={channels.includes(channel)}
            className={CHECKBOX}
          />{' '}
          {channel === 'web'
            ? 'Push'
            : channel === 'email'
              ? 'Email'
              : 'Webhook'}
        </label>
      ))}
      <button
        className={buttonClass({ variant: 'outline', size: 'sm' })}
        type="submit"
        disabled={busy}
      >
        Save
      </button>
      {error ? (
        <div className="w-full">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </form>
  );
}
