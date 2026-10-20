import { afterEach, describe, expect, it } from '@jest/globals';

import {
  EDGE_TTL_SECONDS,
  edgeCache,
  edgeCacheKey,
  isEdgeCacheable,
  storableCopy,
  withFreshNonce,
} from '../../../src/lib/http/edge-cache';

/** The pages these tests let the edge keep a copy of. */
const pages: ReadonlySet<string> = new Set(['/', '/privacy']);

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

describe('edgeCacheKey', () => {
  it('differs by release, so a deploy never serves old HTML', () => {
    const a = edgeCacheKey(get('/'), 'v1').url;
    const b = edgeCacheKey(get('/'), 'v2').url;
    expect(a).not.toBe(b);
  });

  it('differs by page and ignores the host', () => {
    expect(edgeCacheKey(get('/'), 'v1').url).not.toBe(
      edgeCacheKey(get('/privacy'), 'v1').url,
    );
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
