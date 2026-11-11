'use client';

import { useEffect } from 'react';

import { BACKGROUND_COLOR, BRAND_NAME, THEME_COLOR } from '@/app/_brand';

/** Where a browser's push subscription is posted (and renewed by the worker). */
export const PUSH_SUBSCRIPTIONS_PATH = '/api/users/self/push/subscriptions';

/**
 * The address the worker is registered at. The one worker file serves every
 * app, so what makes it this app's (its name and colours, for the offline
 * page, and where a renewed push subscription goes) travels in the query
 * string.
 */
export const WORKER_URL = `/sw.js?${new URLSearchParams({
  name: BRAND_NAME,
  theme: THEME_COLOR,
  background: BACKGROUND_COLOR,
  push: PUSH_SUBSCRIPTIONS_PATH,
}).toString()}`;

/** The parts of the browser subscribing to pushes uses, so they can be stood in for. */
export interface PushEnvironment {
  readonly pushManager: Readonly<{
    subscribe: (
      options: PushSubscriptionOptionsInit,
    ) => Promise<PushSubscription>;
    getSubscription: () => Promise<PushSubscription | null>;
  }>;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/** A base64url VAPID key as the bytes `pushManager.subscribe` takes. */
export function applicationServerKey(
  base64url: string,
): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.codePointAt(0) ?? 0);
}

/** Throw when a response is not a success, so the caller shows the failure. */
async function expectOk(response: Response, what: string): Promise<Response> {
  if (!response.ok) throw new Error(`${what} failed (${response.status})`);
  return response;
}

/**
 * Subscribe this browser to pushes: fetch the server's VAPID key, ask the
 * browser for a subscription with it, and post that to the API. The caller
 * has already asked for notification permission.
 */
export async function subscribeToPush(
  environment: PushEnvironment,
): Promise<void> {
  const configuration = await expectOk(
    await environment.fetch('/api/push/configuration'),
    'Reading the push configuration',
  );
  const { vapid_public_key: key } = (await configuration.json()) as {
    vapid_public_key: string;
  };
  const subscription = await environment.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(key),
  });
  await expectOk(
    await environment.fetch(PUSH_SUBSCRIPTIONS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    }),
    'Saving the push subscription',
  );
}

/**
 * Stop pushes to this browser: delete its subscription (`id`, from the
 * settings page) on the server, then in the browser.
 */
export async function unsubscribeFromPush(
  environment: PushEnvironment,
  id: string,
): Promise<void> {
  const response = await environment.fetch(`${PUSH_SUBSCRIPTIONS_PATH}/${id}`, {
    method: 'DELETE',
  });
  if (response.status !== 404)
    await expectOk(response, 'Removing the push subscription');
  const subscription = await environment.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

/** The parts of the browser the registration uses, so they can be stood in for. */
export interface WorkerEnvironment {
  readonly production: boolean;
  readonly serviceWorker?: Readonly<{
    register: (script: string, options: { scope: string }) => Promise<unknown>;
  }>;
  readonly readyState: DocumentReadyState;
  readonly onLoad: (listener: () => void) => () => void;
}

/**
 * Register the service worker (`public/sw.js`) as soon as the page has finished
 * loading, so registering never competes with the page's own load. Does nothing
 * in development (a worker would hold on to stale pages) or in a browser
 * without service workers.
 * @returns A function that stops waiting for the load, if it was still waiting.
 */
export function registerWhenLoaded(
  environment: WorkerEnvironment,
): (() => void) | undefined {
  const { production, serviceWorker, readyState } = environment;
  if (!production || !serviceWorker) {
    return undefined;
  }
  const register = () => {
    void serviceWorker.register(WORKER_URL, { scope: '/' });
  };
  if (readyState === 'complete') {
    register();
    return undefined;
  }
  return environment.onLoad(register);
}

/**
 * Registers the service worker (see `public/sw.js`) once the page has loaded, so
 * the app is installable and shows an offline page. It does nothing in
 * development, where a worker would hold on to stale pages.
 */
export function ServiceWorker(): null {
  useEffect(
    () =>
      registerWhenLoaded({
        production: process.env.NODE_ENV === 'production',
        serviceWorker:
          // eslint-disable-next-line n/no-unsupported-features/node-builtins -- experimental API used on purpose
          'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
        readyState: document.readyState,
        onLoad: (listener) => {
          window.addEventListener('load', listener, { once: true });
          return () => window.removeEventListener('load', listener);
        },
      }),
    [],
  );
  return null;
}
