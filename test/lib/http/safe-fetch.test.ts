import { describe, expect, it } from '@jest/globals';

import {
  fetchCapped,
  isPublicWebUrl,
  USER_AGENT,
  type CappedFetchOptions,
  type SafeFetcher,
  type SafeRequestInit,
} from '../../../src/lib/http/safe-fetch';
import { SITE_URL } from '../../../src/lib/site';

describe('isPublicWebUrl', () => {
  it.each([
    'https://thewoksoflife.com/wp-content/uploads/a.jpg',
    'http://www.site.co.uk/a.png',
    'https://cdn.example-food.com:443/a.webp',
    'https://a.com:80/x',
    'https://a.com/x?y=1#z',
  ])('accepts %s', (url) => {
    expect(isPublicWebUrl(url)).toBe(true);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://a.com/x.jpg',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'https://localhost/x.jpg',
    'https://localhost./x.jpg',
    'http://127.0.0.1/x.jpg',
    'http://10.0.0.5/x.jpg',
    'http://192.168.1.1/x.jpg',
    'http://172.20.0.1/x.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x.jpg',
    'http://[fe80::1]/x.jpg',
    'http://2130706433/x.jpg',
    'http://0x7f.1/x.jpg',
    'http://017700000001/x.jpg',
    'https://intranet/x.jpg',
    'https://printer.local/x.jpg',
    'https://printer.local./x.jpg',
    'https://db.internal/x.jpg',
    'https://host.localdomain/x.jpg',
    'https://1.0.0.127.in-addr.arpa/x.jpg',
    'https://a.test/x',
    'https://a.com:8080/x.jpg',
    'https://a.com:22/x',
    'https://user:pw@a.com/x.jpg',
    'https://user@a.com/x.jpg',
    'not a url',
    '',
  ])('refuses %s', (url) => {
    expect(isPublicWebUrl(url)).toBe(false);
  });

  it('refuses an address longer than 2,048 characters', () => {
    expect(isPublicWebUrl(`https://a.com/${'x'.repeat(2040)}`)).toBe(false);
    expect(isPublicWebUrl(`https://a.com/${'x'.repeat(2000)}`)).toBe(true);
  });
});

/** Options that accept anything small, with a short limit so the tests stay quick. */
const OPTIONS: CappedFetchOptions = {
  maxBytes: 100,
  timeoutMs: 2000,
  accept: 'text/plain',
  acceptsType: () => true,
};

/** A response that serves `pieces` and records whether the reader gave up on it. */
function streaming(
  pieces: readonly (string | Uint8Array)[],
  headers: Record<string, string> = {},
): { readonly response: Response; readonly state: { cancelled: boolean } } {
  const encoder = new TextEncoder();
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      pieces.forEach((piece) =>
        controller.enqueue(
          typeof piece === 'string' ? encoder.encode(piece) : piece,
        ),
      );
      controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { response: new Response(body, { headers }), state };
}

/** A fetcher that serves the given responses in turn and remembers each call. */
function serving(...responses: readonly Response[]): {
  readonly fetcher: SafeFetcher;
  readonly calls: { readonly url: string; readonly init: SafeRequestInit }[];
} {
  const calls: { url: string; init: SafeRequestInit }[] = [];
  const fetcher: SafeFetcher = async (url, init) => {
    calls.push({ url, init });
    const next = responses[calls.length - 1];
    if (!next) {
      throw new Error('no more responses');
    }
    return next;
  };
  return { fetcher, calls };
}

/** A redirect to `location`. */
const redirect = (location: string | null, status = 302): Response =>
  new Response(null, {
    status,
    headers: location === null ? {} : { Location: location },
  });

describe('fetchCapped', () => {
  it('returns the body, its type and the address it came from', async () => {
    const { fetcher } = serving(
      new Response('hello', {
        headers: { 'content-type': 'Text/Plain; charset=utf-8' },
      }),
    );
    const result = await fetchCapped('https://a.com/x', {
      ...OPTIONS,
      fetcher,
    });
    expect(result).toMatchObject({
      ok: true,
      type: 'text/plain',
      url: 'https://a.com/x',
      truncated: false,
    });
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe('hello');
  });

  it('introduces itself honestly, asks for what it wants and follows no redirect by itself', async () => {
    const { fetcher, calls } = serving(new Response('x'));
    await fetchCapped('https://a.com/x', {
      ...OPTIONS,
      accept: 'image/*',
      edgeCache: { cacheEverything: true, cacheTtl: 60 },
      fetcher,
    });
    const init = calls[0]?.init;
    expect(init?.headers).toEqual({
      Accept: 'image/*',
      'User-Agent': USER_AGENT,
    });
    expect(USER_AGENT).toContain(SITE_URL);
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.cf).toEqual({ cacheEverything: true, cacheTtl: 60 });
  });

  it('sends nothing for an address it will not fetch', async () => {
    const { fetcher, calls } = serving(new Response('x'));
    const result = await fetchCapped('http://127.0.0.1:8080/', {
      ...OPTIONS,
      fetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'blocked' });
    expect(calls).toHaveLength(0);
  });

  describe('redirects', () => {
    it('follows them, relative ones too, and reports the final address', async () => {
      const { fetcher, calls } = serving(
        redirect('/two'),
        redirect('https://b.com/three', 301),
        new Response('done'),
      );
      const result = await fetchCapped('https://a.com/one', {
        ...OPTIONS,
        fetcher,
      });
      expect(calls.map((c) => c.url)).toEqual([
        'https://a.com/one',
        'https://a.com/two',
        'https://b.com/three',
      ]);
      expect(result).toMatchObject({ ok: true, url: 'https://b.com/three' });
    });

    it.each([
      'http://127.0.0.1:8080/admin',
      'http://localhost/x',
      'https://a.com:8443/x',
      'http://169.254.169.254/latest/meta-data',
      'file:///etc/passwd',
      'https://user:pw@b.com/x',
    ])('refuses to be sent on to %s', async (target) => {
      const { fetcher, calls } = serving(redirect(target), new Response('x'));
      const result = await fetchCapped('https://a.com/x', {
        ...OPTIONS,
        fetcher,
      });
      expect(result).toEqual({ ok: false, reason: 'blocked' });
      expect(calls).toHaveLength(1);
    });

    it('stops after the redirects it is allowed', async () => {
      const { fetcher, calls } = serving(
        redirect('/1'),
        redirect('/2'),
        redirect('/3'),
        redirect('/4'),
        new Response('x'),
      );
      const result = await fetchCapped('https://a.com/0', {
        ...OPTIONS,
        fetcher,
      });
      expect(result).toEqual({ ok: false, reason: 'redirects' });
      expect(calls).toHaveLength(4);
    });

    it('honours a lower limit', async () => {
      const { fetcher } = serving(redirect('/1'), new Response('x'));
      expect(
        await fetchCapped('https://a.com/0', {
          ...OPTIONS,
          maxRedirects: 0,
          fetcher,
        }),
      ).toEqual({ ok: false, reason: 'redirects' });
    });

    it('refuses a redirect that points nowhere', async () => {
      const { fetcher } = serving(redirect(null), redirect('http://['));
      expect(
        await fetchCapped('https://a.com/0', { ...OPTIONS, fetcher }),
      ).toEqual({ ok: false, reason: 'redirects' });
    });
  });

  it('reports the status of a response that is not a success', async () => {
    const { fetcher } = serving(new Response('no', { status: 403 }));
    expect(
      await fetchCapped('https://a.com/x', { ...OPTIONS, fetcher }),
    ).toEqual({ ok: false, reason: 'status', status: 403 });
  });

  it('refuses a type it did not ask for without reading the body', async () => {
    const { response, state } = streaming(['<svg/>'], {
      'content-type': 'image/svg+xml',
    });
    const { fetcher } = serving(response);
    const result = await fetchCapped('https://a.com/x', {
      ...OPTIONS,
      acceptsType: (type) => type.startsWith('text/'),
      fetcher,
    });
    expect(result).toEqual({ ok: false, reason: 'type' });
    expect(state.cancelled).toBe(true);
  });

  it('gives the type of a site that does not say as an empty string', async () => {
    const seen: string[] = [];
    const { fetcher } = serving(
      new Response(new Uint8Array([1]), { headers: {} }),
    );
    await fetchCapped('https://a.com/x', {
      ...OPTIONS,
      acceptsType: (type) => {
        seen.push(type);
        return true;
      },
      fetcher,
    });
    expect(seen).toEqual(['']);
  });

  describe('size', () => {
    it('refuses a body that announces it is too long, reading none of it', async () => {
      const { response, state } = streaming(['x'], {
        'content-length': '5000',
      });
      const { fetcher } = serving(response);
      expect(
        await fetchCapped('https://a.com/x', { ...OPTIONS, fetcher }),
      ).toEqual({ ok: false, reason: 'too-large' });
      expect(state.cancelled).toBe(true);
    });

    it('cuts off a body with no declared length once it passes the limit, and drops it', async () => {
      const { response, state } = streaming([
        'x'.repeat(60),
        'x'.repeat(60),
        'x'.repeat(60),
      ]);
      const { fetcher } = serving(response);
      expect(
        await fetchCapped('https://a.com/x', { ...OPTIONS, fetcher }),
      ).toEqual({ ok: false, reason: 'too-large' });
      expect(state.cancelled).toBe(true);
    });

    it('stops pulling from a body that never ends', async () => {
      const pulls = { count: 0 };
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls.count += 1;
          controller.enqueue(new Uint8Array(40));
        },
      });
      const { fetcher } = serving(new Response(endless));
      expect(
        await fetchCapped('https://a.com/x', { ...OPTIONS, fetcher }),
      ).toEqual({ ok: false, reason: 'too-large' });
      expect(pulls.count).toBeLessThan(10);
    });

    it('accepts a body of exactly the limit', async () => {
      const { fetcher } = serving(new Response('x'.repeat(100)));
      const result = await fetchCapped('https://a.com/x', {
        ...OPTIONS,
        fetcher,
      });
      expect(result.ok && result.bytes.byteLength).toBe(100);
    });

    it('turns away a body dribbled in thousands of tiny pieces', async () => {
      const { response, state } = streaming(
        Array.from({ length: 5000 }, () => 'x'),
      );
      const { fetcher } = serving(response);
      const result = await fetchCapped('https://a.com/x', {
        ...OPTIONS,
        maxBytes: 1_000_000,
        fetcher,
      });
      expect(result).toEqual({ ok: false, reason: 'too-large' });
      expect(state.cancelled).toBe(true);
    });

    it('can keep the start of a long body instead, and says it did', async () => {
      const { response, state } = streaming([
        'a'.repeat(60),
        'b'.repeat(60),
        'c'.repeat(60),
      ]);
      const { fetcher } = serving(response);
      const result = await fetchCapped('https://a.com/x', {
        ...OPTIONS,
        overflow: 'truncate',
        fetcher,
      });
      expect(result).toMatchObject({ ok: true, truncated: true });
      expect(result.ok && new TextDecoder().decode(result.bytes)).toBe(
        `${'a'.repeat(60)}${'b'.repeat(40)}`,
      );
      expect(state.cancelled).toBe(true);
    });

    it('does not mind a long declared length when it is only keeping the start', async () => {
      const { fetcher } = serving(
        new Response('x'.repeat(100), {
          headers: { 'content-length': '999999' },
        }),
      );
      const result = await fetchCapped('https://a.com/x', {
        ...OPTIONS,
        overflow: 'truncate',
        fetcher,
      });
      expect(result).toMatchObject({ ok: true });
    });

    it('reads a body with no pieces at all as empty', async () => {
      const { fetcher } = serving(new Response(null, { status: 200 }));
      const result = await fetchCapped('https://a.com/x', {
        ...OPTIONS,
        fetcher,
      });
      expect(result.ok && result.bytes.byteLength).toBe(0);
    });
  });

  describe('failure', () => {
    it('says unreachable when the request throws', async () => {
      const fetcher: SafeFetcher = async () => {
        throw new TypeError('fetch failed');
      };
      expect(
        await fetchCapped('https://a.com/x', { ...OPTIONS, fetcher }),
      ).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('says unreachable when the body breaks off', async () => {
      const broken = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('reset'));
        },
      });
      const { fetcher } = serving(new Response(broken));
      expect(
        await fetchCapped('https://a.com/x', { ...OPTIONS, fetcher }),
      ).toEqual({ ok: false, reason: 'unreachable' });
    });

    it('says timeout when the site is too slow to answer', async () => {
      const fetcher: SafeFetcher = (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          ),
        );
      expect(
        await fetchCapped('https://a.com/x', {
          ...OPTIONS,
          timeoutMs: 20,
          fetcher,
        }),
      ).toEqual({ ok: false, reason: 'timeout' });
    });

    it('says timeout when the body stalls', async () => {
      const fetcher: SafeFetcher = async (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init.signal?.addEventListener('abort', () =>
                controller.error(init.signal?.reason),
              );
            },
          }),
        );
      expect(
        await fetchCapped('https://a.com/x', {
          ...OPTIONS,
          timeoutMs: 20,
          fetcher,
        }),
      ).toEqual({ ok: false, reason: 'timeout' });
    });
  });

  it('uses the real fetch when no fetcher is given', async () => {
    const real = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('real');
    }) as typeof fetch;
    try {
      const result = await fetchCapped('https://a.com/real', OPTIONS);
      expect(result.ok && new TextDecoder().decode(result.bytes)).toBe('real');
      expect(calls).toEqual(['https://a.com/real']);
    } finally {
      globalThis.fetch = real;
    }
  });
});
