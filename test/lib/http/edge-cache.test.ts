import { afterEach, describe, expect, it } from '@jest/globals';

import {
  edgeCache,
  edgeCacheKey,
  isEdgeCacheable,
  storableCopy,
  withFreshNonce,
} from '../../../src/lib/http/edge-cache';
import {
  CACHED_QUERY_PARAMS,
  EDGE_CACHED_PAGES,
  EDGE_TTL_SECONDS,
} from '../../../src/lib/http/site';

/** The pages these tests let the edge keep a copy of. */
const pages: ReadonlySet<string> = new Set(['/', '/privacy']);

/** The query names these tests let a kept page carry. */
const allowed: ReadonlySet<string> = new Set(['alpha', 'beta']);

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${path}`, { headers });

describe('isEdgeCacheable', () => {
  it('keeps the public pages for signed-out visitors', () => {
    expect(isEdgeCacheable(get('/'), pages, 'app_session')).toBe(true);
    expect(isEdgeCacheable(get('/privacy'), pages, 'app_session')).toBe(true);
  });

  it('never serves a copy to someone with a session cookie', () => {
    expect(
      isEdgeCacheable(
        get('/', { cookie: 'a=b; app_session=abc' }),
        pages,
        'app_session',
      ),
    ).toBe(false);
  });

  it('keeps a page for everyone in an app that has no sign-in', () => {
    expect(
      isEdgeCacheable(
        get('/', { cookie: 'app_session=abc' }),
        pages,
        undefined,
      ),
    ).toBe(true);
  });

  it('ignores other cookies', () => {
    expect(
      isEdgeCacheable(get('/', { cookie: 'theme=dark' }), pages, 'app_session'),
    ).toBe(true);
  });

  it('leaves personal pages, queries, other methods and authorised calls alone', () => {
    expect(isEdgeCacheable(get('/app'), pages, 'app_session')).toBe(false);
    expect(isEdgeCacheable(get('/recipe/abc'), pages, 'app_session')).toBe(
      false,
    );
    expect(isEdgeCacheable(get('/?source=pwa'), pages, 'app_session')).toBe(
      false,
    );
    expect(
      isEdgeCacheable(
        get('/', { authorization: 'Bearer x' }),
        pages,
        'app_session',
      ),
    ).toBe(false);
    expect(
      isEdgeCacheable(
        new Request('https://app.test/', { method: 'POST' }),
        pages,
        'app_session',
      ),
    ).toBe(false);
  });
});

describe('isEdgeCacheable - the query string', () => {
  const ok = (path: string, names: ReadonlySet<string> = allowed) =>
    isEdgeCacheable(get(path), pages, 'app_session', names);

  it('accepts a query made only of allowed names', () => {
    expect(ok('/?alpha=1')).toBe(true);
    expect(ok('/?beta=x&alpha=y')).toBe(true);
    expect(ok('/?alpha=')).toBe(true);
  });

  it('refuses a name that is not allowed, even beside allowed ones', () => {
    expect(ok('/?gamma=1')).toBe(false);
    expect(ok('/?alpha=1&gamma=1')).toBe(false);
  });

  it('refuses every query when no names are allowed', () => {
    expect(ok('/?alpha=1', new Set())).toBe(false);
    expect(ok('/', new Set())).toBe(true);
  });

  it('refuses a name given twice and a value over 64 characters', () => {
    expect(ok('/?alpha=1&alpha=2')).toBe(false);
    expect(ok(`/?alpha=${'a'.repeat(64)}`)).toBe(true);
    expect(ok(`/?alpha=${'a'.repeat(65)}`)).toBe(false);
  });

  it('refuses more than eight parameters', () => {
    const many = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(ok('/?a=1&b=1&c=1&d=1&e=1&f=1&g=1&h=1', many)).toBe(true);
    expect(ok('/?a=1&b=1&c=1&d=1&e=1&f=1&g=1&h=1&i=1', many)).toBe(false);
  });

  it('never keeps what a developer sees on their own machine', () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
      expect(
        isEdgeCacheable(
          new Request(`http://${host}/?alpha=1`),
          pages,
          'app_session',
          allowed,
        ),
      ).toBe(false);
    }
  });

  it('never keeps a page that `wrangler dev` addressed by its route but was asked for on localhost', () => {
    for (const host of ['localhost:3000', '127.0.0.1:8787', '[::1]:3000']) {
      expect(
        isEdgeCacheable(
          get('/?alpha=1', { host }),
          pages,
          'app_session',
          allowed,
        ),
      ).toBe(false);
    }
    expect(
      isEdgeCacheable(
        get('/?alpha=1', { host: 'app.test' }),
        pages,
        'app_session',
        allowed,
      ),
    ).toBe(true);
  });

  it('never keeps a page for a caller on a loopback address, whatever address it was reached on', () => {
    for (const ip of ['::1', '127.0.0.1', '::ffff:127.0.0.1']) {
      expect(
        isEdgeCacheable(
          get('/?alpha=1', { 'cf-connecting-ip': ip }),
          pages,
          'app_session',
          allowed,
        ),
      ).toBe(false);
    }
    expect(
      isEdgeCacheable(
        get('/?alpha=1', { 'cf-connecting-ip': '203.0.113.7' }),
        pages,
        'app_session',
        allowed,
      ),
    ).toBe(true);
  });

  it('still refuses a session cookie on a page with a query', () => {
    expect(
      isEdgeCacheable(
        get('/?alpha=1', { cookie: 'app_session=abc' }),
        pages,
        'app_session',
        allowed,
      ),
    ).toBe(false);
  });
});

describe('edgeCacheKey', () => {
  it('differs by release, so a deploy never serves old HTML', () => {
    const a = edgeCacheKey(get('/'), 'v1').url;
    const b = edgeCacheKey(get('/'), 'v2').url;
    expect(a).not.toBe(b);
  });

  it('has the release id in it', () => {
    expect(edgeCacheKey(get('/'), 'rel-9').url).toContain('rel-9');
  });

  it('does not depend on the order of the parameters', () => {
    expect(edgeCacheKey(get('/?beta=2&alpha=1'), 'v1', allowed).url).toBe(
      edgeCacheKey(get('/?alpha=1&beta=2'), 'v1', allowed).url,
    );
  });

  it('differs by parameter value and from the page with no query', () => {
    const plain = edgeCacheKey(get('/'), 'v1', allowed).url;
    const one = edgeCacheKey(get('/?alpha=1'), 'v1', allowed).url;
    const two = edgeCacheKey(get('/?alpha=2'), 'v1', allowed).url;
    expect(new Set([plain, one, two]).size).toBe(3);
  });

  it('differs by page and ignores the host', () => {
    expect(edgeCacheKey(get('/'), 'v1').url).not.toBe(
      edgeCacheKey(get('/privacy'), 'v1').url,
    );
  });
});

describe('the app’s own settings', () => {
  it('keeps only pages it also accepts, with a positive lifetime', () => {
    for (const page of EDGE_CACHED_PAGES) {
      expect(page.startsWith('/')).toBe(true);
      expect(page.includes('?')).toBe(false);
    }
    expect(EDGE_TTL_SECONDS).toBeGreaterThan(0);
  });

  it('accepts a request that carries one of its own names, and refuses one that does not', () => {
    const [page] = [...EDGE_CACHED_PAGES];
    expect(page).toBeDefined();
    expect(isEdgeCacheable(get(`${page}?zz-unknown=1`))).toBe(false);
    const [name] = [...CACHED_QUERY_PARAMS];
    expect(isEdgeCacheable(get(`${page}${name ? `?${name}=1` : ''}`))).toBe(
      true,
    );
    if (name === undefined) {
      expect(isEdgeCacheable(get(`${page}?x=1`))).toBe(false);
    }
  });
});

describe('storableCopy', () => {
  const html = (init: ResponseInit = {}) =>
    new Response('<p>hi</p>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      ...init,
    });

  it('marks a good page public for the edge and leaves the original intact', async () => {
    const original = html();
    const copy = storableCopy(original)!;
    expect(copy.headers.get('cache-control')).toBe(
      `public, max-age=${EDGE_TTL_SECONDS}`,
    );
    expect(await copy.text()).toBe('<p>hi</p>');
    expect(await original.text()).toBe('<p>hi</p>');
  });

  it('keeps a feed as well as a page', () => {
    const feed = new Response('<rss/>', {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
    });
    expect(storableCopy(feed)).not.toBeNull();
  });

  it('keeps nothing that is not a plain successful page', () => {
    expect(storableCopy(html({ status: 404 }))).toBeNull();
    expect(storableCopy(html({ status: 307 }))).toBeNull();
    expect(
      storableCopy(
        new Response('x', { headers: { 'content-type': 'application/json' } }),
      ),
    ).toBeNull();
  });

  it('never keeps a response that sets a cookie', () => {
    const response = html();
    response.headers.append('set-cookie', 'app_session=abc');
    expect(storableCopy(response)).toBeNull();
  });
});

describe('edgeCache', () => {
  const original = Reflect.get(globalThis, 'caches');
  afterEach(() => {
    Reflect.set(globalThis, 'caches', original);
  });

  it('is absent where there is no Workers cache (plain Node)', () => {
    Reflect.set(globalThis, 'caches', undefined);
    expect(edgeCache()).toBeUndefined();
  });

  it('is the default cache when the runtime has one', () => {
    const fake = { match: async () => undefined, put: async () => undefined };
    Reflect.set(globalThis, 'caches', { default: fake });
    expect(edgeCache()).toBe(fake);
  });

  it('ignores something that is not a cache', () => {
    Reflect.set(globalThis, 'caches', { default: {} });
    expect(edgeCache()).toBeUndefined();
  });
});

describe('withFreshNonce', () => {
  const cached = () =>
    new Response(
      '<script nonce="old1"></script><script nonce="old1"></script>',
      {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': "script-src 'nonce-old1' 'strict-dynamic'",
        },
      },
    );

  it('puts the new nonce in every script and in the policy, and the old one nowhere', async () => {
    const out = await withFreshNonce(
      cached(),
      'new2',
      "script-src 'nonce-new2' 'strict-dynamic'",
    );
    const body = await out.text();
    expect(body).toBe(
      '<script nonce="new2"></script><script nonce="new2"></script>',
    );
    expect(out.headers.get('content-security-policy')).toBe(
      "script-src 'nonce-new2' 'strict-dynamic'",
    );
  });

  it('keeps the status and the other headers', async () => {
    const out = await withFreshNonce(
      cached(),
      'new2',
      "script-src 'nonce-new2'",
    );
    expect(out.status).toBe(200);
    expect(out.headers.get('content-type')).toBe('text/html');
  });

  it('returns a page whose policy has no nonce as it is', async () => {
    const plain = new Response('<p>x</p>', {
      headers: { 'content-type': 'text/html' },
    });
    expect(await withFreshNonce(plain, 'new2', "script-src 'nonce-new2'")).toBe(
      plain,
    );
  });
});
