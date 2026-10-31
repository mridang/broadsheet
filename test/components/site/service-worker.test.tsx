import { describe, expect, it, jest } from '@jest/globals';

import {
  applicationServerKey,
  PUSH_SUBSCRIPTIONS_PATH,
  registerWhenLoaded,
  subscribeToPush,
  unsubscribeFromPush,
  type PushEnvironment,
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

describe('WORKER_URL', () => {
  it('tells the worker where a renewed push subscription goes', () => {
    expect(new URL(WORKER_URL, 'https://p').searchParams.get('push')).toBe(
      PUSH_SUBSCRIPTIONS_PATH,
    );
  });
});

describe('applicationServerKey', () => {
  it('decodes an unpadded base64url key', () => {
    expect(applicationServerKey('-_8')).toEqual(new Uint8Array([251, 255]));
  });
});

/** A browser with a push manager, and a server answering each call in turn. */
function pushing(...answers: Response[]) {
  const calls: { input: string; init?: RequestInit }[] = [];
  const unsubscribe = jest.fn(async () => true);
  const subscription = {
    toJSON: () => ({ endpoint: 'https://push.example.com/x', keys: {} }),
    unsubscribe,
  } as unknown as PushSubscription;
  const subscribe = jest.fn<PushEnvironment['pushManager']['subscribe']>(
    async () => subscription,
  );
  const env: PushEnvironment = {
    pushManager: { subscribe, getSubscription: async () => subscription },
    fetch: async (input, init) => {
      calls.push({ input, init });
      return answers[calls.length - 1] ?? new Response(null, { status: 204 });
    },
  };
  return { env, calls, subscribe, unsubscribe };
}

describe('subscribeToPush', () => {
  it('subscribes with the server key and posts the subscription', async () => {
    const { env, calls, subscribe } = pushing(
      Response.json({ vapid_public_key: 'AAE' }),
      new Response(null, { status: 201 }),
    );
    await subscribeToPush(env);
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([0, 1]),
    });
    expect(calls[1]).toMatchObject({
      input: PUSH_SUBSCRIPTIONS_PATH,
      init: {
        method: 'POST',
        body: '{"endpoint":"https://push.example.com/x","keys":{}}',
      },
    });
  });

  it('fails when the server has no push configuration', async () => {
    const { env, subscribe } = pushing(new Response(null, { status: 503 }));
    await expect(subscribeToPush(env)).rejects.toThrow('503');
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe('unsubscribeFromPush', () => {
  it('deletes the subscription on the server, then in the browser', async () => {
    const { env, calls, unsubscribe } = pushing();
    await unsubscribeFromPush(env, '7');
    expect(calls[0]).toMatchObject({
      input: `${PUSH_SUBSCRIPTIONS_PATH}/7`,
      init: { method: 'DELETE' },
    });
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('still unsubscribes the browser when the server had already forgotten it', async () => {
    const { env, unsubscribe } = pushing(new Response(null, { status: 404 }));
    await unsubscribeFromPush(env, '7');
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('keeps the browser subscribed when the server refused', async () => {
    const { env, unsubscribe } = pushing(new Response(null, { status: 500 }));
    await expect(unsubscribeFromPush(env, '7')).rejects.toThrow('500');
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
