'use client';

import { useEffect } from 'react';

import { BACKGROUND_COLOR, BRAND_NAME, THEME_COLOR } from '@/app/_brand';

/**
 * The address the worker is registered at. The one worker file serves every
 * app, so what makes it this app's (its name and colours, for the offline
 * page) travels in the query string.
 */
export const WORKER_URL = `/sw.js?${new URLSearchParams({
  name: BRAND_NAME,
  theme: THEME_COLOR,
  background: BACKGROUND_COLOR,
}).toString()}`;

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
 *
 * @returns A function that stops waiting for the load, if it was still waiting.
 */
export function registerWhenLoaded(
  environment: WorkerEnvironment,
): (() => void) | undefined {
  const { serviceWorker } = environment;
  if (!environment.production || !serviceWorker) {
    return undefined;
  }
  const register = () => {
    void serviceWorker.register(WORKER_URL, { scope: '/' });
  };
  if (environment.readyState === 'complete') {
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
