import { describe, expect, it, jest } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const SW_SOURCE = await readFile(
  path.join(process.cwd(), 'public/sw.js'),
  'utf8',
);

type Listener = (event: never) => void;

/** What the worker did with a fetch event. */
type Handled = { answered: boolean; response: Promise<Response> | null };

/**
 * Runs `public/sw.js` in a context shaped like a service worker scope, with a
 * network that either works (`online`) or fails, and a browser that does or
 * does not support navigation preload. Returns the listeners it registered.
 */
function loadWorker(options: {
  online: boolean;
  preload: boolean;
  /** The query string the worker was registered with. */
  query?: string;
}) {
  const listeners = new Map<string, Listener>();
  const calls = {
    preloadEnabled: 0,
    claimed: 0,
    skipped: 0,
    shown: [] as { title: string; options: Record<string, unknown> }[],
    opened: [] as string[],
    fetched: [] as { url: string; init?: Record<string, unknown> }[],
    subscribedWith: [] as Record<string, unknown>[],
  };
  const windows: { url: string; focus: jest.Mock; navigate: jest.Mock }[] = [];
  const self = {
    location: {
      href: `https://app.example/sw.js${options.query ?? ''}`,
      origin: 'https://app.example',
    },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: () => {
      calls.skipped += 1;
    },
    clients: {
      claim: async () => {
        calls.claimed += 1;
      },
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        calls.opened.push(url);
      },
    },
    registration: {
      showNotification: async (
        title: string,
        notification: Record<string, unknown>,
      ) => {
        calls.shown.push({ title, options: notification });
      },
      pushManager: {
        subscribe: async (subscribeOptions: Record<string, unknown>) => {
          calls.subscribedWith.push(subscribeOptions);
          return { toJSON: () => ({ endpoint: 'https://push.test/renewed' }) };
        },
      },
      navigationPreload: options.preload
        ? {
            enable: async () => {
              calls.preloadEnabled += 1;
            },
          }
        : undefined,
    },
  };
  const context = vm.createContext({
    self,
    Response,
    Promise,
    URL,
    URLSearchParams,
    console,
    fetch: async (url: string, init?: Record<string, unknown>) => {
      calls.fetched.push({ url, init });
      if (!options.online) {
        throw new TypeError('offline');
      }
      return new Response('from the network');
    },
  });
  // eslint-disable-next-line sonarjs/code-eval -- the test runs the repo's own public/sw.js in a sandboxed vm context
  vm.runInContext(SW_SOURCE, context);
  return { listeners, calls, windows };
}

/** Fires a fetch event and reports whether the worker answered it. */
function fetchEvent(
  listeners: Map<string, Listener>,
  mode: string,
  preloadResponse: Promise<Response | undefined> = Promise.resolve(undefined),
): Handled {
  const answers: Promise<Response>[] = [];
  const event = {
    request: { mode },
    preloadResponse,
    respondWith: (response: Promise<Response>) => answers.push(response),
  };
  listeners.get('fetch')?.(event as never);
  return { answered: answers.length > 0, response: answers[0] ?? null };
}

describe('public/sw.js', () => {
  it('listens for install, activate and fetch', () => {
    const { listeners } = loadWorker({ online: true, preload: true });
    expect(
      [...listeners.keys()].toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([
      'activate',
      'fetch',
      'install',
      'notificationclick',
      'push',
      'pushsubscriptionchange',
    ]);
  });

  it('takes over straight away on install', () => {
    const { listeners, calls } = loadWorker({ online: true, preload: true });
    listeners.get('install')?.({} as never);
    expect(calls.skipped).toBe(1);
  });

  it('claims open pages and turns on navigation preload when the browser has it', async () => {
    const { listeners, calls } = loadWorker({ online: true, preload: true });
    const waited: Promise<unknown>[] = [];
    listeners.get('activate')?.({
      waitUntil: (p: Promise<unknown>) => waited.push(p),
    } as never);
    await Promise.all(waited);
    expect(calls).toMatchObject({ claimed: 1, preloadEnabled: 1 });
  });

  it('still activates in a browser without navigation preload', async () => {
    const { listeners, calls } = loadWorker({ online: true, preload: false });
    const waited: Promise<unknown>[] = [];
    listeners.get('activate')?.({
      waitUntil: (p: Promise<unknown>) => waited.push(p),
    } as never);
    await Promise.all(waited);
    expect(calls).toMatchObject({ claimed: 1, preloadEnabled: 0 });
  });

  it('does not answer anything but page navigations', () => {
    const { listeners } = loadWorker({ online: false, preload: true });
    for (const mode of ['cors', 'no-cors', 'same-origin']) {
      expect(fetchEvent(listeners, mode).answered).toBe(false);
    }
  });

  it('uses the preloaded response when there is one', async () => {
    const { listeners } = loadWorker({ online: false, preload: true });
    const handled = fetchEvent(
      listeners,
      'navigate',
      Promise.resolve(new Response('preloaded')),
    );
    const response = await handled.response;
    expect(await response?.text()).toBe('preloaded');
  });

  it('fetches the page itself when nothing was preloaded', async () => {
    const { listeners } = loadWorker({ online: true, preload: false });
    const handled = fetchEvent(listeners, 'navigate');
    const response = await handled.response;
    expect(await response?.text()).toBe('from the network');
  });

  it('says it is offline, with a 503 page, when the network fails', async () => {
    const { listeners } = loadWorker({ online: false, preload: false });
    const response = await fetchEvent(listeners, 'navigate').response;
    expect(response?.status).toBe(503);
    expect(response?.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(await response?.text()).toContain("You're offline");
  });

  it('names the app and takes its colours from the address it was registered at', async () => {
    const { listeners } = loadWorker({
      online: false,
      preload: false,
      query: '?name=Pantry&theme=%23112233&background=%23ffeedd',
    });
    const response = await fetchEvent(listeners, 'navigate').response;
    const page = await response?.text();
    expect(page).toContain('Offline · Pantry');
    expect(page).toContain('Pantry needs a connection');
    expect(page).toContain('<meta name="theme-color" content="#112233">');
    expect(page).toContain('background: #ffeedd');
  });

  it('cannot be made to put markup or a stray colour into the offline page', async () => {
    const { listeners } = loadWorker({
      online: false,
      preload: false,
      query: '?name=%3Cb%3Ex%3C/b%3E&theme=red&background=url(x)',
    });
    const response = await fetchEvent(listeners, 'navigate').response;
    const page = await response?.text();
    expect(page).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(page).not.toContain('<b>x</b>');
    expect(page).not.toContain('url(x)');
  });

  it('writes light text on a dark page and dark text on a light one', async () => {
    const dark = loadWorker({
      online: false,
      preload: false,
      query: '?background=%231f1f22',
    });
    const light = loadWorker({
      online: false,
      preload: false,
      query: '?background=%23fbf8f2',
    });
    const darkResponse = await fetchEvent(dark.listeners, 'navigate').response;
    expect(await darkResponse?.text()).toContain('color: #f3f3f6');
    const lightResponse = await fetchEvent(light.listeners, 'navigate')
      .response;
    expect(await lightResponse?.text()).toContain('color: #15120e');
  });

  it('gives the offline page an icon and a retry button', async () => {
    const { listeners } = loadWorker({ online: false, preload: false });
    const response = await fetchEvent(listeners, 'navigate').response;
    const page = await response?.text();
    expect(page).toContain('<link rel="icon" href="/icon.svg"');
    expect(page).toContain('location.reload()');
  });
});

/** Fires a push event with a JSON payload (or a broken one) and waits for the notification. */
async function push(
  worker: ReturnType<typeof loadWorker>,
  data: string | null,
) {
  const waited: Promise<unknown>[] = [];
  worker.listeners.get('push')?.({
    data: data === null ? null : { json: () => JSON.parse(data) },
    waitUntil: (p: Promise<unknown>) => waited.push(p),
  } as never);
  await Promise.all(waited);
  return worker.calls.shown;
}

describe('public/sw.js: push', () => {
  it('shows the notification the payload describes', async () => {
    const worker = loadWorker({
      online: true,
      preload: false,
      query: '?name=Pantry',
    });
    const shown = await push(
      worker,
      '{"title":"Dinner","body":"Soup","tag":"daily","image":"https://app.example/a.png","url":"https://app.example/x"}',
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe('Dinner');
    expect(shown[0]?.options).toMatchObject({
      body: 'Soup',
      tag: 'daily',
      image: 'https://app.example/a.png',
      renotify: true,
      requireInteraction: true,
      data: { url: 'https://app.example/x' },
    });
  });

  it('still shows one, under the app’s name, when the payload cannot be read', async () => {
    const worker = loadWorker({
      online: true,
      preload: false,
      query: '?name=Pantry',
    });
    const waited: Promise<unknown>[] = [];
    worker.listeners.get('push')?.({
      data: { json: () => JSON.parse('not json') },
      waitUntil: (p: Promise<unknown>) => waited.push(p),
    } as never);
    await Promise.all(waited);
    expect(worker.calls.shown[0]?.title).toBe('Pantry');
    expect(worker.calls.shown[0]?.options).toMatchObject({
      data: { url: 'https://app.example' },
    });
  });

  it('does not ask for a renotify without a tag, which browsers reject', async () => {
    const worker = loadWorker({ online: true, preload: false });
    const shown = await push(worker, null);
    expect(shown[0]?.options).toMatchObject({ renotify: false });
  });
});

describe('public/sw.js: tapping a notification', () => {
  /** Fires a click on a notification that carries `url`, and waits for the worker. */
  async function tap(worker: ReturnType<typeof loadWorker>, url?: string) {
    const waited: Promise<unknown>[] = [];
    const close = jest.fn();
    worker.listeners.get('notificationclick')?.({
      notification: { close, data: url ? { url } : undefined },
      waitUntil: (p: Promise<unknown>) => waited.push(p),
    } as never);
    await Promise.all(waited);
    return close;
  }

  it('closes it and opens the address it carries', async () => {
    const worker = loadWorker({ online: true, preload: false });
    const close = await tap(worker, 'https://app.example/x');
    expect(close).toHaveBeenCalledTimes(1);
    expect(worker.calls.opened).toEqual(['https://app.example/x']);
  });

  it('never follows an address on another site', async () => {
    const worker = loadWorker({ online: true, preload: false });
    await tap(worker, 'https://evil.example/');
    expect(worker.calls.opened).toEqual(['https://app.example']);
  });

  it('opens the app when the notification carries no address', async () => {
    const worker = loadWorker({ online: true, preload: false });
    await tap(worker);
    expect(worker.calls.opened).toEqual(['https://app.example']);
  });

  it('focuses a tab that is already open instead of opening another', async () => {
    const worker = loadWorker({ online: true, preload: false });
    const focus = jest.fn(async () => undefined);
    const navigate = jest.fn(async (url: string) => url);
    worker.windows.push({
      url: 'https://app.example/',
      focus,
      navigate,
    } as never);
    await tap(worker, 'https://app.example/x');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('https://app.example/x');
    expect(worker.calls.opened).toEqual([]);
  });
});

/** Fires a `pushsubscriptionchange` and waits for the worker to finish with it. */
async function renew(
  worker: ReturnType<typeof loadWorker>,
  event: Record<string, unknown>,
): Promise<void> {
  const waited: Promise<unknown>[] = [];
  worker.listeners.get('pushsubscriptionchange')?.({
    ...event,
    waitUntil: (p: Promise<unknown>) => waited.push(p),
  } as never);
  await Promise.all(waited);
}

describe('public/sw.js: pushsubscriptionchange', () => {
  const query = '?push=%2Fapi%2Fusers%2Fself%2Fpush%2Fsubscriptions';

  it('posts the new subscription the browser hands over to the push path', async () => {
    const worker = loadWorker({ online: true, preload: false, query });
    await renew(worker, {
      newSubscription: {
        toJSON: () => ({ endpoint: 'https://push.test/new' }),
      },
    });
    expect(worker.calls.fetched).toEqual([
      {
        url: '/api/users/self/push/subscriptions',
        init: expect.objectContaining({
          method: 'POST',
          body: '{"endpoint":"https://push.test/new"}',
        }),
      },
    ]);
  });

  it('subscribes again with the old key when the browser hands over none', async () => {
    const worker = loadWorker({ online: true, preload: false, query });
    await renew(worker, {
      oldSubscription: { options: { applicationServerKey: 'key' } },
    });
    expect(worker.calls.subscribedWith).toEqual([
      { userVisibleOnly: true, applicationServerKey: 'key' },
    ]);
    expect(worker.calls.fetched[0]?.init?.['body']).toBe(
      '{"endpoint":"https://push.test/renewed"}',
    );
  });

  it('does nothing without a subscription to post', async () => {
    const worker = loadWorker({ online: true, preload: false, query });
    await renew(worker, {});
    expect(worker.calls.fetched).toEqual([]);
  });

  it.each(['', '?push=https%3A%2F%2Fevil.test%2Fx', '?push=%2F%2Fevil.test'])(
    'posts nowhere when the push path %s is not on this site',
    async (q) => {
      const worker = loadWorker({ online: true, preload: false, query: q });
      await renew(worker, {
        newSubscription: { toJSON: () => ({}) },
      });
      expect(worker.calls.fetched).toEqual([]);
    },
  );
});
