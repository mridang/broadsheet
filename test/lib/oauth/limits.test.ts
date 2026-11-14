import { describe, expect, it, jest } from '@jest/globals';

import {
  OAUTH_LIMITS,
  clientAddress,
  firstRetryAfter,
  retryAfterIfLimited,
  tooManyRequests,
} from '@/lib/oauth';
import type { RateLimit, RateLimitStore } from '@/lib/rate-limit';
import ips from '../../fixtures/ips.json' with { type: 'json' };

/** A store that counts hits per key in memory, in one never-ending window that opens at the first hit. */
function countingStore(): RateLimitStore & { readonly keys: string[] } {
  const windows = new Map<string, { count: number; windowStart: number }>();
  const keys: string[] = [];
  return {
    keys,
    async hit(key, now) {
      keys.push(key);
      const window = windows.get(key) ?? { count: 0, windowStart: now };
      const next = { ...window, count: window.count + 1 };
      windows.set(key, next);
      return next;
    },
    async purge() {},
  };
}

const TWO: RateLimit = { name: 'two', limit: 2, windowSeconds: 60 };

describe('clientAddress', () => {
  it('prefers the address Cloudflare saw', () => {
    expect(
      clientAddress(
        new Headers({
          'cf-connecting-ip': '203.0.113.7',
          'x-forwarded-for': '198.51.100.1',
        }),
      ),
    ).toBe('203.0.113.7');
  });

  it('falls back to the first hop of X-Forwarded-For', () => {
    expect(
      clientAddress(
        new Headers({ 'x-forwarded-for': ' 198.51.100.1 , 10.0.0.1' }),
      ),
    ).toBe('198.51.100.1');
  });

  it.each([
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:1111:2222:3333:4444', '2001:db8:1:2::/64'],
    [ips.upperV6One, '2001:db8:0:0::/64'],
  ])(
    'puts IPv6 address %s in its /64 so a network shares one counter',
    (address, subject) => {
      expect(clientAddress(new Headers({ 'cf-connecting-ip': address }))).toBe(
        subject,
      );
      expect(clientAddress(new Headers({ 'x-forwarded-for': address }))).toBe(
        subject,
      );
    },
  );

  it('leaves an IPv4 address as it is', () => {
    expect(
      clientAddress(new Headers({ 'cf-connecting-ip': '203.0.113.7' })),
    ).toBe('203.0.113.7');
  });

  it('shares one bucket when there is no address at all', () => {
    expect(clientAddress(new Headers())).toBe('unknown');
    expect(clientAddress(new Headers({ 'cf-connecting-ip': ' ' }))).toBe(
      'unknown',
    );
  });
});

describe('retryAfterIfLimited', () => {
  it('lets requests through up to the limit, then says how long to wait', async () => {
    const store = countingStore();
    expect(await retryAfterIfLimited(store, TWO, 'a', 100)).toBeUndefined();
    expect(await retryAfterIfLimited(store, TWO, 'a', 100)).toBeUndefined();
    expect(await retryAfterIfLimited(store, TWO, 'a', 110)).toBe(50);
  });

  it('counts each subject separately', async () => {
    const store = countingStore();
    await retryAfterIfLimited(store, TWO, 'a', 100);
    await retryAfterIfLimited(store, TWO, 'a', 100);
    expect(await retryAfterIfLimited(store, TWO, 'b', 100)).toBeUndefined();
  });

  it('fails open, and says so in the log, when the counter is unreachable', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken: RateLimitStore = {
      async hit() {
        throw new Error('D1 down');
      },
      async purge() {},
    };
    expect(await retryAfterIfLimited(broken, TWO, 'a', 100)).toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('firstRetryAfter', () => {
  it('is undefined when every limit allows the request, and counts each', async () => {
    const store = countingStore();
    const result = await firstRetryAfter(
      store,
      [
        { limit: TWO, subject: 'host' },
        { limit: { ...TWO, name: 'all' }, subject: 'all' },
      ],
      100,
    );
    expect(result).toBeUndefined();
    expect(store.keys).toEqual(['two:host', 'all:all']);
  });

  it('stops at the first limit that refuses', async () => {
    const store = countingStore();
    const one: RateLimit = { name: 'one', limit: 1, windowSeconds: 60 };
    const checks = [
      { limit: one, subject: 'host' },
      { limit: TWO, subject: 'all' },
    ];
    await firstRetryAfter(store, checks, 100);
    store.keys.splice(0);
    expect(await firstRetryAfter(store, checks, 100)).toBe(60);
    expect(store.keys).toEqual(['one:host']);
  });

  it('allows a request with nothing to check', async () => {
    expect(await firstRetryAfter(countingStore(), [])).toBeUndefined();
  });
});

describe('tooManyRequests', () => {
  it('answers 429 with Retry-After and an OAuth error body', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const response = tooManyRequests(42, 'token');
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'oauth.rate_limited',
        endpoint: 'token',
        retryAfterSeconds: 42,
      }),
    );
    warn.mockRestore();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: 'temporarily_unavailable',
      error_description: 'Too many requests. Try again in 42 seconds.',
    });
  });
});

describe('OAUTH_LIMITS', () => {
  it('names every limit distinctly, so their counters never mix', () => {
    const names = Object.values(OAUTH_LIMITS).map((limit) => limit.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
