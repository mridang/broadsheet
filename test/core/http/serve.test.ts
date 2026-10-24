import { describe, expect, it } from '@jest/globals';

import { nonceOf } from '@/core/http/csp';
import { genericLimits } from '@/core/http/edge-limits';
import { serve, type ServeApp } from '@/core/http/serve';

/** What is rate limited in these tests: the classes every app has, with sessions in `app_session`. */
const limits = genericLimits('app_session');
/** The one page these tests let the edge keep a copy of. */
const pages: ReadonlySet<string> = new Set(['/']);
/** The query names these tests let a kept page carry. */
const queryParams: ReadonlySet<string> = new Set(['alpha', 'beta']);
/** A rate limit binding that refuses everyone, and counts how often it was asked. */
function refusing(): {
  limit: () => Promise<{ success: boolean }>;
  asked: number;
} {
  const binding = {
    asked: 0,
    limit: async () => {
      binding.asked += 1;
      return { success: false };
    },
  };
  return binding;
}

/** A cache that keeps responses in memory, keyed by URL. */
function memoryCache(): Cache & { readonly stored: Map<string, Response> } {
  const stored = new Map<string, Response>();
  return {
    stored,
    match: async (request: RequestInfo | URL) =>
      stored
        .get(request instanceof Request ? request.url : String(request))
        ?.clone(),
    put: async (request: RequestInfo | URL, response: Response) => {
      stored.set(
        request instanceof Request ? request.url : String(request),
        response,
      );
    },
  } as unknown as Cache & { readonly stored: Map<string, Response> };
}

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    context: {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  };
};

/** An app that answers every request with the given response factory and remembers what it was sent. */
function appAnswering(make: (request: Request) => Response): ServeApp & {
  readonly seen: Request[];
} {
  const seen: Request[] = [];
  return {
    seen,
    fetch: (request) => {
      seen.push(request);
      return make(request);
    },
  };
}

const html = () =>
  new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } });

const page = (body: string, nonce: string) =>
  new Response(`<html><script nonce="${nonce}">${body}</script></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const get = (pathname = '/app', headers: Record<string, string> = {}) =>
  new Request(`https://app.test${pathname}`, { headers });

describe('serve', () => {
  it('passes the policy and its nonce to the app, and puts the policy on an HTML response', async () => {
    const app = appAnswering(html);
    const response = await serve(get(), {}, ctx().context, {
      app,
      limits,
    });
    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = nonceOf(csp);
    expect(nonce).toBeDefined();
    expect(app.seen[0]?.headers.get('x-nonce')).toBe(nonce);
    expect(app.seen[0]?.headers.get('content-security-policy')).toBe(csp);
  });

  it('sends only the enforced policy, never a report-only one', async () => {
    const response = await serve(get(), {}, ctx().context, {
      app: appAnswering(html),
      limits,
    });
    expect(response.headers.has('content-security-policy')).toBe(true);
    expect(response.headers.has('content-security-policy-report-only')).toBe(
      false,
    );
  });

  it('uses a new nonce for every request', async () => {
    const app = appAnswering(html);
    const { context } = ctx();
    await serve(get(), {}, context, { app, limits });
    await serve(get(), {}, context, { app, limits });
    expect(app.seen[0]?.headers.get('x-nonce')).not.toBe(
      app.seen[1]?.headers.get('x-nonce'),
    );
  });

  it('replaces a policy or nonce the caller sent instead of forwarding it', async () => {
    const app = appAnswering(html);
    await serve(
      get('/app', {
        'x-nonce': 'attacker',
        'content-security-policy': "script-src 'nonce-attacker'",
      }),
      {},
      ctx().context,
      { app, limits },
    );
    expect(app.seen[0]?.headers.get('x-nonce')).not.toBe('attacker');
    expect(app.seen[0]?.headers.get('content-security-policy')).not.toContain(
      'attacker',
    );
  });

  it('leaves a policy the app set itself alone, and adds none to a response that is not HTML', async () => {
    const own = appAnswering(
      () =>
        new Response('x', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy': 'default-src none',
          },
        }),
    );
    const json = appAnswering(() => Response.json({ a: 1 }));
    const { context } = ctx();
    const a = await serve(get(), {}, context, { app: own, limits });
    expect(a.headers.get('content-security-policy')).toBe('default-src none');
    const b = await serve(get('/api/x'), {}, context, {
      app: json,
      limits,
    });
    expect(b.headers.get('content-security-policy')).toContain(
      'frame-ancestors',
    );
    expect(b.headers.get('content-security-policy')).not.toContain('nonce-');
  });

  it('gives the approval screen the policy that forbids framing and omits form-action', async () => {
    const response = await serve(
      get('/oauth/authorize?x=1'),
      {},
      ctx().context,
      { app: appAnswering(html), limits },
    );
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('form-action');
  });

  it('adds the site’s security headers to every answer', async () => {
    const response = await serve(get('/health'), {}, ctx().context, {
      app: appAnswering(() => new Response('{}')),
      limits,
    });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toContain(
      'max-age=',
    );
  });
});

describe('serve — flow id', () => {
  it('gives the app and the caller the id the caller sent', async () => {
    const app = appAnswering(html);
    const response = await serve(
      get('/app', { 'x-flow-id': 'abc-123' }),
      {},
      ctx().context,
      { app, limits },
    );
    expect(app.seen[0]?.headers.get('x-flow-id')).toBe('abc-123');
    expect(response.headers.get('x-flow-id')).toBe('abc-123');
  });

  it('makes one up when none was sent, or when it is not a sane id', async () => {
    for (const sent of [undefined, 'has space', 'x'.repeat(129)]) {
      const app = appAnswering(html);
      const response = await serve(
        get('/app', sent === undefined ? {} : { 'x-flow-id': sent }),
        {},
        ctx().context,
        { app, limits },
      );
      const id = response.headers.get('x-flow-id') ?? '';
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(app.seen[0]?.headers.get('x-flow-id')).toBe(id);
    }
  });

  it('is on a refusal too', async () => {
    const response = await serve(
      get('/app', { 'x-flow-id': 'f1' }),
      { RL_SITE: refusing() },
      ctx().context,
      { app: appAnswering(html), limits },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('x-flow-id')).toBe('f1');
  });
});

describe('serve — rate limits', () => {
  it('refuses a caller over a limit with a 429 and the site’s headers, before the app is asked', async () => {
    const app = appAnswering(html);
    const response = await serve(
      get('/app'),
      { RL_SITE: refusing() },
      ctx().context,
      { app, limits },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(app.seen).toEqual([]);
  });

  it('counts a page that comes from the edge copy, and refuses it just the same', async () => {
    const cache = memoryCache();
    const app = appAnswering(() => page('a', 'n'));
    const { context, pending } = ctx();
    await serve(get('/'), {}, context, { app, cache, limits, pages });
    await Promise.all(pending);
    expect(cache.stored.size).toBe(1);
    const binding = refusing();
    const response = await serve(get('/'), { RL_SITE: binding }, context, {
      app,
      cache,
      limits,
      pages,
    });
    expect(response.status).toBe(429);
    expect(binding.asked).toBe(1);
    expect(app.seen).toHaveLength(1);
  });

  it('counts a picture, which the app keeps a copy of itself', async () => {
    const app = appAnswering(() => new Response('image'));
    const binding = refusing();
    const response = await serve(
      get('/img?url=https://a.test/p.jpg'),
      { RL_COVER: binding },
      ctx().context,
      { app, limits },
    );
    expect(response.status).toBe(429);
    expect(app.seen).toEqual([]);
  });
});

describe('serve — the edge copy', () => {
  it('stores a public page and answers the next visitor without the app', async () => {
    const cache = memoryCache();
    let renders = 0;
    const app = appAnswering(() => {
      renders += 1;
      return page('a', 'will-be-replaced');
    });
    const { context, pending } = ctx();
    const first = await serve(get('/'), {}, context, {
      app,
      cache,
      limits,
      pages,
    });
    await Promise.all(pending);
    const second = await serve(get('/'), {}, context, {
      app,
      cache,
      limits,
      pages,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(renders).toBe(1);
    expect(await second.text()).toContain('<script');
  });

  it('gives every visit to a kept page a nonce of its own, in the scripts and in the policy', async () => {
    const cache = memoryCache();
    const app = appAnswering((request) =>
      page('a', request.headers.get('x-nonce') ?? 'none'),
    );
    const { context, pending } = ctx();
    const deps = { app, cache, limits, pages };
    const first = await serve(get('/'), {}, context, deps);
    await Promise.all(pending);
    const second = await serve(get('/'), {}, context, deps);
    const third = await serve(get('/'), {}, context, deps);
    const nonces = [first, second, third].map((r) =>
      nonceOf(r.headers.get('content-security-policy') ?? ''),
    );
    expect(new Set(nonces).size).toBe(3);
    for (const response of [second, third]) {
      const nonce = nonceOf(
        response.headers.get('content-security-policy') ?? '',
      );
      expect(await response.text()).toContain(`nonce="${nonce}"`);
    }
  });

  it.each([
    ['a page with a session cookie', { cookie: 'app_session=abc' }, '/'],
    [
      'a page asked for with a bearer token',
      { authorization: 'Bearer x' },
      '/',
    ],
    ['a page with a query name that is not allowed', {}, '/?x=1'],
    ['a page with an allowed name given twice', {}, '/?alpha=1&alpha=2'],
    ['a page that is not public', {}, '/app'],
  ])('does not store %s', async (_label, headers, url) => {
    const cache = memoryCache();
    const { context, pending } = ctx();
    await serve(get(url, headers), {}, context, {
      app: appAnswering(() => page('a', 'n')),
      cache,
      limits,
      pages,
      queryParams,
    });
    await Promise.all(pending);
    expect(cache.stored.size).toBe(0);
  });

  it('does not store a page on a developer’s machine', async () => {
    const cache = memoryCache();
    const { context, pending } = ctx();
    await serve(new Request('http://localhost:3000/'), {}, context, {
      app: appAnswering(() => page('a', 'n')),
      cache,
      limits,
      pages,
    });
    await Promise.all(pending);
    expect(cache.stored.size).toBe(0);
  });

  it('stores a page with allowed parameters once, however they are ordered', async () => {
    const cache = memoryCache();
    const app = appAnswering(() => page('a', 'n'));
    const { context, pending } = ctx();
    const deps = { app, cache, limits, pages, queryParams };
    await serve(get('/?alpha=1&beta=2'), {}, context, deps);
    await Promise.all(pending);
    await serve(get('/?beta=2&alpha=1'), {}, context, deps);
    expect(app.seen).toHaveLength(1);
    expect(cache.stored.size).toBe(1);
    await serve(get('/?alpha=2&beta=2'), {}, context, deps);
    expect(app.seen).toHaveLength(2);
  });

  it('counts a page with a query that comes from the edge copy', async () => {
    const cache = memoryCache();
    const app = appAnswering(() => page('a', 'n'));
    const { context, pending } = ctx();
    const deps = { app, cache, limits, pages, queryParams };
    await serve(get('/?alpha=1'), {}, context, deps);
    await Promise.all(pending);
    const binding = refusing();
    const response = await serve(
      get('/?alpha=1'),
      { RL_SITE: binding },
      context,
      deps,
    );
    expect(response.status).toBe(429);
    expect(binding.asked).toBe(1);
    expect(app.seen).toHaveLength(1);
  });

  it('does not store a response that sets a cookie or is not a success', async () => {
    for (const make of [
      () =>
        new Response('x', {
          headers: { 'content-type': 'text/html', 'set-cookie': 'a=b' },
        }),
      () =>
        new Response('x', {
          status: 500,
          headers: { 'content-type': 'text/html' },
        }),
    ]) {
      const cache = memoryCache();
      const { context, pending } = ctx();
      await serve(get('/'), {}, context, {
        app: appAnswering(make),
        cache,
        limits,
        pages,
      });
      await Promise.all(pending);
      expect(cache.stored.size).toBe(0);
    }
  });

  it('keys the copy by release, so a deploy never serves old HTML', async () => {
    const cache = memoryCache();
    const app = appAnswering(() => page('a', 'n'));
    const { context, pending } = ctx();
    const deps = { app, cache, limits, pages };
    await serve(get('/'), { CF_VERSION_METADATA: { id: 'v1' } }, context, deps);
    await Promise.all(pending);
    await serve(get('/'), { CF_VERSION_METADATA: { id: 'v2' } }, context, deps);
    expect(app.seen).toHaveLength(2);
  });

  it('runs without an edge cache', async () => {
    const response = await serve(get('/'), {}, ctx().context, {
      app: appAnswering(() => page('a', 'n')),
      cache: undefined,
      limits,
      pages,
    });
    expect(response.status).toBe(200);
  });
});
