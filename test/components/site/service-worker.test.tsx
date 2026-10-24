import { describe, expect, it, jest } from '@jest/globals';

import {
  registerWhenLoaded,
  ServiceWorker,
  WORKER_URL,
  type WorkerEnvironment,
} from '@/components/site/service-worker';
import { html } from '../render';

/** A browser stand-in: production, with service workers, still loading. */
function browser(
  overrides: Partial<WorkerEnvironment> = {},
): WorkerEnvironment & { register: jest.Mock } {
  const register = jest.fn(async () => undefined);
  return {
    production: true,
    serviceWorker: { register },
    readyState: 'loading',
    onLoad: () => () => undefined,
    ...overrides,
    register,
  };
}

describe('ServiceWorker', () => {
  it('draws nothing: it only registers the worker once the page has loaded', () => {
    expect(html(<ServiceWorker />)).toBe('');
  });
});

describe('registerWhenLoaded', () => {
  it('registers at once when the page has already loaded', () => {
    const env = browser({ readyState: 'complete' });
    registerWhenLoaded(env);
    expect(env.register).toHaveBeenCalledWith(WORKER_URL, { scope: '/' });
  });

  it('waits for the load event when the page is still loading', () => {
    const listeners: (() => void)[] = [];
    const env = browser({
      onLoad: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    });
    registerWhenLoaded(env);
    expect(env.register).not.toHaveBeenCalled();
    listeners.forEach((listener) => listener());
    expect(env.register).toHaveBeenCalledTimes(1);
  });

  it('hands back the way to stop waiting', () => {
    const stop = jest.fn();
    const cleanup = registerWhenLoaded(browser({ onLoad: () => stop }));
    cleanup?.();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does nothing in development, where a worker would keep stale pages', () => {
    const env = browser({ production: false, readyState: 'complete' });
    expect(registerWhenLoaded(env)).toBeUndefined();
    expect(env.register).not.toHaveBeenCalled();
  });

  it('does nothing in a browser without service workers', () => {
    const env = browser({ serviceWorker: undefined, readyState: 'complete' });
    expect(registerWhenLoaded(env)).toBeUndefined();
    expect(env.register).not.toHaveBeenCalled();
  });
});
