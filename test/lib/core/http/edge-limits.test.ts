import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';

import {
  GENERIC_CLASSES,
  OVERALL_BINDING,
  counterKey,
  edgeLimitRefusal,
  genericClass,
  genericLimits,
  tooManyRequests,
  type GenericClass,
  type RateLimitBinding,
} from '@/lib/core/http';
import { EDGE_LIMITS } from '@/lib/core/http';

/** A binding that allows the first `allowance` calls per key and refuses the rest. */
function binding(allowance: number): RateLimitBinding & {
  readonly keys: string[];
} {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key);
      return { success: keys.filter((k) => k === key).length <= allowance };
    },
  };
}

const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.test${url}`, { headers });

const limits = genericLimits('app_session');

describe('genericClass', () => {
  it.each<[string, GenericClass | undefined]>([
    ['/_next/static/chunks/a.js', undefined],
    ['/icons/icon-192.png', undefined],
    ['/csp/reports', 'reports'],
    ['/img', 'cover'],
    ['/api/things', 'api'],
    ['/api/things/abc', 'api'],
    ['/rpc/anything', 'api'],
    ['/health', 'discovery'],
    ['/.well-known/anything', 'discovery'],
    ['/robots.txt', 'discovery'],
    ['/', 'site'],
    ['/anything/at/all', 'site'],
  ])('puts %s in %s', (pathname, expected) => {
    expect(genericClass(pathname)).toBe(expected);
  });
});

describe('genericLimits', () => {
  it('counts the classes every app has, and tells a visitor with a session apart by its cookie', () => {
    expect(limits.classes).toBe(GENERIC_CLASSES);
    expect(limits.sessionCookie).toBe('app_session');
    expect(limits.classify(get('/'))).toBe('site');
    expect(limits.classify(get('/_next/x.js'))).toBeUndefined();
  });
});

describe('counterKey', () => {
  it('counts a signed-in person by a hash of their session cookie, never the cookie itself', async () => {
    const key = await counterKey(
      'person',
      new Headers({ cookie: 'a=1; app_session=SECRET.value; b=2' }),
      'app_session',
    );
    expect(key).toMatch(/^p:[0-9a-f]{32}$/);
    expect(key).not.toContain('SECRET');
  });

  it('gives different cookies different keys and the same cookie the same key', async () => {
    const of = (value: string) =>
      counterKey(
        'person',
        new Headers({ cookie: `app_session=${value}` }),
        'app_session',
      );
    expect(await of('one')).toBe(await of('one'));
    expect(await of('one')).not.toBe(await of('two'));
  });

  it('falls back to the address for a caller with no cookie', async () => {
    expect(
      await counterKey(
        'person',
        new Headers({ 'cf-connecting-ip': '203.0.113.7' }),
        'app_session',
      ),
    ).toBe('a:203.0.113.7');
  });

  it('counts a bearer token by hash, and an anonymous caller by address', async () => {
    expect(
      await counterKey(
        'token',
        new Headers({ authorization: 'Bearer abc123' }),
        undefined,
      ),
    ).toMatch(/^t:[0-9a-f]{32}$/);
    expect(
      await counterKey(
        'token',
        new Headers({ 'cf-connecting-ip': '2001:db8:1:2::9' }),
        undefined,
      ),
    ).toBe('a:2001:db8:1:2::/64');
  });
});

describe('edgeLimitRefusal', () => {
  it('lets a request through when there is no binding', async () => {
    expect(await edgeLimitRefusal(get('/'), {}, limits)).toBeNull();
  });

  it('lets a request through when the counter throws', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken: RateLimitBinding = {
      limit: async () => {
        throw new Error('down');
      },
    };
    expect(
      await edgeLimitRefusal(get('/'), { RL_SITE: broken }, limits),
    ).toBeNull();
    spy.mockRestore();
  });

  it('does not count static files or CORS preflights', async () => {
    const site = binding(0);
    const env = { RL_SITE: site, RL_API: site, [OVERALL_BINDING]: site };
    expect(
      await edgeLimitRefusal(get('/_next/static/x.js'), env, limits),
    ).toBeNull();
    expect(
      await edgeLimitRefusal(
        new Request('https://app.test/api/things', { method: 'OPTIONS' }),
        env,
        limits,
      ),
    ).toBeNull();
    expect(site.keys).toEqual([]);
  });

  it('refuses the request after the allowance, with Retry-After', async () => {
    const env = { RL_SITE: binding(2) };
    const headers = { 'cf-connecting-ip': '203.0.113.7' };
    expect(await edgeLimitRefusal(get('/', headers), env, limits)).toBeNull();
    expect(await edgeLimitRefusal(get('/', headers), env, limits)).toBeNull();
    const refused = await edgeLimitRefusal(get('/', headers), env, limits);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('retry-after')).toBe('60');
  });

  it('counts callers separately', async () => {
    const env = { RL_SITE: binding(1) };
    const from = (ip: string) => get('/', { 'cf-connecting-ip': ip });
    expect(await edgeLimitRefusal(from('203.0.113.1'), env, limits)).toBeNull();
    expect(await edgeLimitRefusal(from('203.0.113.2'), env, limits)).toBeNull();
    expect(
      (await edgeLimitRefusal(from('203.0.113.1'), env, limits))?.status,
    ).toBe(429);
  });

  it('counts a person in their class and again in the overall bucket for their address', async () => {
    const api = binding(100);
    const overall = binding(100);
    await edgeLimitRefusal(
      get('/api/recipes', {
        cookie: 'app_session=abc',
        'cf-connecting-ip': '203.0.113.7',
      }),
      { RL_API: api, [OVERALL_BINDING]: overall },
      limits,
    );
    expect(api.keys[0]).toMatch(/^p:/);
    expect(overall.keys).toEqual(['a:203.0.113.7']);
  });

  it('stops a caller who makes up cookies at the overall bucket', async () => {
    const env = { RL_API: binding(100), [OVERALL_BINDING]: binding(1) };
    const forged = (i: number) =>
      get('/api/recipes', {
        cookie: `app_session=forged${i}`,
        'cf-connecting-ip': '203.0.113.7',
      });
    expect(await edgeLimitRefusal(forged(1), env, limits)).toBeNull();
    expect((await edgeLimitRefusal(forged(2), env, limits))?.status).toBe(429);
  });
});

describe('tooManyRequests', () => {
  it('answers an MCP client with a JSON-RPC error it can read cross-origin', async () => {
    const response = tooManyRequests('jsonrpc', 60);
    expect(response.status).toBe(429);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, data: { retryAfterSeconds: 60 } },
    });
  });

  it('answers an OAuth client with an OAuth error', async () => {
    const response = tooManyRequests('oauth', 60);
    expect(await response.json()).toMatchObject({
      error: 'temporarily_unavailable',
    });
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('answers the API with a problem document', async () => {
    const response = tooManyRequests('problem', 60);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    expect(await response.json()).toMatchObject({
      type: '/problems/rate-limited',
      status: 429,
    });
  });

  it('answers a page with plain text', async () => {
    const response = tooManyRequests('text', 60);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('wrangler.jsonc', () => {
  const parsed = ts.parseConfigFileTextToJson(
    'wrangler.jsonc',
    readFileSync(path.join(process.cwd(), 'wrangler.jsonc'), 'utf8'),
  ).config as {
    ratelimits: {
      name: string;
      namespace_id: string;
      simple: { limit: number; period: number };
    }[];
  };

  it('declares a binding for every class and for the overall bucket, and no others', () => {
    const declared = parsed.ratelimits.map((r) => r.name).toSorted();
    const expected = [
      ...Object.values(EDGE_LIMITS.classes).map((c) => c.binding),
      OVERALL_BINDING,
    ].toSorted();
    expect(declared).toEqual(expected);
  });

  it('gives each binding its own namespace, because namespaces share counters account-wide', () => {
    const ids = parsed.ratelimits.map((r) => r.namespace_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses the period each class tells a refused caller to wait', () => {
    for (const spec of Object.values(EDGE_LIMITS.classes)) {
      const entry = parsed.ratelimits.find((r) => r.name === spec.binding);
      expect(entry?.simple.period).toBe(spec.periodSeconds);
    }
  });
});
