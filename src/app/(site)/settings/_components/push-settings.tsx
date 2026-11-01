'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  subscribeToPush,
  unsubscribeFromPush,
  type PushEnvironment,
} from '@/components/site/service-worker';
import { buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorText, Notice } from '@/components/ui/notice';

/** Where this browser stands with pushes. */
type PushState = 'unsupported' | 'loading' | 'off' | { readonly id: string };

/** The browser's push manager, once the service worker is ready. */
async function environment(): Promise<PushEnvironment> {
  const registration = await navigator.serviceWorker.ready;
  return {
    pushManager: registration.pushManager,
    fetch: (input, init) => fetch(input, init),
  };
}

/**
 * Turn the "your paper is ready" push on or off for this browser.
 * `subscriptions` are the person's known browsers, so this one's id is found
 * by its endpoint.
 */
export function PushSettings({
  subscriptions,
}: Readonly<{
  subscriptions: readonly { id: number; endpoint: string }[];
}>): ReactElement {
  const [state, setState] = useState<PushState>('loading');
  const { busy, error, run } = useApiAction(() => window.location.reload());

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    void (supported ? environment() : Promise.reject(new Error('unsupported')))
      .then((env) => env.pushManager.getSubscription())
      .then((current) => {
        const known = subscriptions.find(
          (s) => s.endpoint === current?.endpoint,
        );
        setState(known ? { id: String(known.id) } : 'off');
      })
      .catch(() => setState(supported ? 'off' : 'unsupported'));
  }, [subscriptions]);

  if (state === 'unsupported') {
    return <Notice>This browser cannot receive notifications.</Notice>;
  }
  const on = typeof state === 'object';
  const toggle = (): Promise<void> =>
    run(
      async () => {
        const env = await environment();
        if (on) {
          await unsubscribeFromPush(env, state.id);
          return;
        }
        if ((await Notification.requestPermission()) !== 'granted') {
          throw new Error('Notifications are blocked for this site.');
        }
        await subscribeToPush(env);
      },
      on
        ? 'Could not turn notifications off.'
        : 'Could not turn notifications on.',
    );
  return (
    <Card padding="none">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">This browser</p>
          <p className="mt-0.5 text-xs text-subtle">
            {on ? 'Notified when your paper is ready.' : 'Not notified.'}
          </p>
        </div>
        <button
          type="button"
          className={buttonClass({
            variant: on ? 'outline' : 'primary',
            size: 'sm',
          })}
          disabled={busy || state === 'loading'}
          onClick={() => void toggle()}
        >
          {on
            ? 'Stop notifying this browser'
            : 'Notify this browser when my paper is ready'}
        </button>
      </div>
      {error ? (
        <div className="px-5 pb-4">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </Card>
  );
}
