'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  subscribeToPush,
  unsubscribeFromPush,
  type PushEnvironment,
} from '@/components/site/service-worker';

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
    return <p className="muted">This browser cannot receive notifications.</p>;
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
    <>
      <p>
        <button
          type="button"
          className="btn"
          disabled={busy || state === 'loading'}
          onClick={() => void toggle()}
        >
          {on
            ? 'Stop notifying this browser'
            : 'Notify this browser when my paper is ready'}
        </button>
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
