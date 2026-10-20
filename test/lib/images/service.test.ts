import { describe, expect, it, jest } from '@jest/globals';

import { snapWidth } from '../../../src/lib/images/address';
import type { ImageFetch } from '../../../src/lib/images/proxy';
import {
  BROWSER_SECONDS,
  EDGE_SECONDS,
  imageCacheKey,
  imageHeaders,
  refuse,
  serveImage,
  type ImageAccess,
  type ImageCache,
} from '../../../src/lib/images/service';
import {
  ALLOWED_HOSTS,
  ALLOWED_WIDTHS,
  DEFAULT_WIDTH,
} from '../../../src/lib/images/site';

const HOST = ALLOWED_HOSTS?.[0] ?? 'photos.example.org';
const PHOTO = `https://${HOST}/soup.jpg`;
const WIDTH = ALLOWED_WIDTHS[0] ?? DEFAULT_WIDTH;

/** A request for a picture. */
function ask(
  url = PHOTO,
  extra = '',
  headers: Record<string, string> = {},
): Request {
  return new Request(
    `https://app.test/api/img?url=${encodeURIComponent(url)}&w=${WIDTH}${extra}`,
    { headers },
  );
}

/** A fetcher that serves a small JPEG. */
const serving: ImageFetch = async () =>
  new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'image/jpeg' },
  });

/** Access rules that let everyone have everything. */
const open: ImageAccess = {
  authenticate: async () => undefined,
  signatureValid: () => true,
  mayFetch: async () => true,
};

/** A cache that remembers what it is given. */
function fakeCache(initial: Response | undefined = undefined) {
  const stored: [string, Response][] = [];
  const cache: ImageCache = {
    match: async () => initial?.clone(),
    put: async (key, response) => {
      stored.push([key instanceof Request ? key.url : String(key), response]);
    },
  };
  return { cache, stored };
}

describe('imageCacheKey', () => {
  it('depends on the width and the picture, not on who asks', () => {
    expect(imageCacheKey(640, PHOTO).url).toBe(
      `https://images.invalid/640/${encodeURIComponent(PHOTO)}`,
    );
    expect(imageCacheKey(320, PHOTO).url).not.toBe(
      imageCacheKey(640, PHOTO).url,
    );
  });
});

describe('imageHeaders', () => {
  it('lets browsers and shared caches keep a picture for good', () => {
    const headers = imageHeaders('image/webp', '"abc"');
    expect(headers.get('cache-control')).toBe(
      `public, max-age=${BROWSER_SECONDS}, s-maxage=${EDGE_SECONDS}, immutable`,
    );
    expect(BROWSER_SECONDS).toBe(2_592_000);
    expect(EDGE_SECONDS).toBe(604_800);
  });

  it('seals the picture and names its type and validator', () => {
    const headers = imageHeaders('image/webp', '"abc"');
    expect(Object.fromEntries(headers)).toEqual({
      'cache-control': expect.any(String),
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-type': 'image/webp',
      'cross-origin-resource-policy': 'same-site',
      etag: '"abc"',
      'x-content-type-options': 'nosniff',
    });
  });
});

describe('refuse', () => {
  it('is a short plain-text sentence that nobody keeps', async () => {
    const response = refuse(403, 'No.');
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('No.\n');
  });
});

describe('serveImage', () => {
  it('fetches the picture, keeps a copy at the edge in the background, and sends it', async () => {
    const { cache, stored } = fakeCache();
    const background = jest.fn((work: Promise<unknown>) => work);
    const response = await serveImage(ask(), {
      access: open,
      cache,
      fetcher: serving,
      background,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe(
      imageHeaders('image/jpeg', '"x"').get('cache-control'),
    );
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(background).toHaveBeenCalledTimes(1);
    await background.mock.results[0]?.value;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[0]).toBe(imageCacheKey(WIDTH, PHOTO).url);
    expect(stored[0]?.[1].headers.get('cache-control')).toBe(
      `public, max-age=${EDGE_SECONDS}`,
    );
    expect(stored[0]?.[1].headers.get('etag')).toBe(
      response.headers.get('etag'),
    );
  });

  it('works without any cache', async () => {
    const background = jest.fn();
    const response = await serveImage(ask(), {
      access: open,
      fetcher: serving,
      background,
    });
    expect(response.status).toBe(200);
    expect(background).not.toHaveBeenCalled();
  });

  it('snaps the width, and uses the default when none is given', async () => {
    const seen: number[] = [];
    const images = {
      input: () => ({
        transform: (options: { width: number }) => {
          seen.push(options.width);
          return {
            output: async () => ({
              response: () => new Response(new Uint8Array([9])),
            }),
          };
        },
      }),
    };
    const big: ImageFetch = async () =>
      new Response(new Uint8Array(100_000), {
        headers: { 'content-type': 'image/jpeg' },
      });
    const base = `https://app.test/api/img?url=${encodeURIComponent(PHOTO)}`;
    const deps = {
      access: open,
      fetcher: big,
      images,
      background: () => undefined,
    };
    await serveImage(new Request(`${base}&w=1`), deps);
    await serveImage(new Request(`${base}&w=abc`), deps);
    await serveImage(new Request(base), deps);
    expect(seen).toEqual([
      snapWidth(1),
      snapWidth(DEFAULT_WIDTH),
      snapWidth(DEFAULT_WIDTH),
    ]);
  });

  describe('from the edge cache', () => {
    const copy = () =>
      new Response('cached', {
        headers: {
          'content-type': 'image/webp',
          etag: '"v1"',
          'cache-control': `public, max-age=${EDGE_SECONDS}`,
        },
      });

    it('answers without asking about access to the picture or fetching it', async () => {
      const fetcher = jest.fn(serving);
      const mayFetch = jest.fn(async () => false);
      const { cache } = fakeCache(copy());
      const response = await serveImage(ask(), {
        access: { ...open, mayFetch },
        cache,
        fetcher,
        background: () => undefined,
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('cached');
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('etag')).toBe('"v1"');
      expect(response.headers.get('cache-control')).toContain('immutable');
      expect(fetcher).not.toHaveBeenCalled();
      expect(mayFetch).not.toHaveBeenCalled();
    });

    it('answers 304, with the headers and no body, when the browser has the current copy', async () => {
      const { cache } = fakeCache(copy());
      const response = await serveImage(
        ask(PHOTO, '', { 'If-None-Match': 'W/"v1", "other"' }),
        { access: open, cache, background: () => undefined },
      );
      expect(response.status).toBe(304);
      expect(response.headers.get('etag')).toBe('"v1"');
      expect(response.headers.get('cache-control')).toContain('immutable');
      expect(await response.text()).toBe('');
    });

    it('sends the picture again when the browser has another version', async () => {
      const { cache } = fakeCache(copy());
      const response = await serveImage(
        ask(PHOTO, '', { 'If-None-Match': '"v0"' }),
        { access: open, cache, background: () => undefined },
      );
      expect(response.status).toBe(200);
    });

    it('fetches again when the stored copy is not one this service made', async () => {
      const { cache } = fakeCache(new Response('odd'));
      const response = await serveImage(ask(), {
        access: open,
        cache,
        fetcher: serving,
        background: () => undefined,
      });
      expect(response.headers.get('content-type')).toBe('image/jpeg');
    });
  });

  it('answers 304 for a picture it has just fetched when the browser has it', async () => {
    const first = await serveImage(ask(), {
      access: open,
      fetcher: serving,
      background: () => undefined,
    });
    const second = await serveImage(
      ask(PHOTO, '', { 'If-None-Match': first.headers.get('etag') ?? '' }),
      { access: open, fetcher: serving, background: () => undefined },
    );
    expect(second.status).toBe(304);
  });

  describe('who may ask', () => {
    it('lets the access rules refuse a caller first, before anything else', async () => {
      const refusal = new Response('no', { status: 401 });
      const fetcher = jest.fn(serving);
      const response = await serveImage(ask('http://127.0.0.1/'), {
        access: { ...open, authenticate: async () => refusal },
        fetcher,
        background: () => undefined,
      });
      expect(response).toBe(refusal);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('refuses with 403, without fetching, a picture the access rules do not let this caller have', async () => {
      const fetcher = jest.fn(serving);
      const asked: string[] = [];
      const response = await serveImage(ask(), {
        access: {
          ...open,
          mayFetch: async (url) => {
            asked.push(url);
            return false;
          },
        },
        fetcher,
        background: () => undefined,
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(asked).toEqual([PHOTO]);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('hands the signature to the access rules, and refuses with 403 when it is wrong', async () => {
      const fetcher = jest.fn(serving);
      const checked: (string | null)[] = [];
      const access: ImageAccess = {
        ...open,
        signatureValid: (_url, signature) => {
          checked.push(signature);
          return signature === 'good';
        },
      };
      const deps = { access, fetcher, background: () => undefined };
      expect((await serveImage(ask(PHOTO, '&sig=bad'), deps)).status).toBe(403);
      expect((await serveImage(ask(), deps)).status).toBe(403);
      expect(fetcher).not.toHaveBeenCalled();
      expect((await serveImage(ask(PHOTO, '&sig=good'), deps)).status).toBe(
        200,
      );
      expect(checked).toEqual(['bad', null, 'good']);
    });

    it('refuses an address that is not a public image with 400, before any other question', async () => {
      const mayFetch = jest.fn(async () => true);
      const signatureValid = jest.fn(() => true);
      const deps = {
        access: { ...open, mayFetch, signatureValid },
        background: () => undefined,
      };
      for (const url of [
        'http://127.0.0.1/x.png',
        'file:///etc/passwd',
        'https://localhost/x.png',
        '',
        `https://${HOST}/${'a'.repeat(3000)}`,
      ]) {
        expect((await serveImage(ask(url), deps)).status).toBe(400);
      }
      expect(
        (await serveImage(new Request('https://app.test/api/img?w=640'), deps))
          .status,
      ).toBe(400);
      expect(mayFetch).not.toHaveBeenCalled();
      expect(signatureValid).not.toHaveBeenCalled();
    });

    it('refuses with 403 a picture from another host, where the app names the hosts it takes them from', async () => {
      const fetcher = jest.fn(serving);
      const hosts = ALLOWED_HOSTS === null ? [] : ['evil.example.org'];
      for (const host of hosts) {
        const response = await serveImage(ask(`https://${host}/a.jpg`), {
          access: open,
          fetcher,
          background: () => undefined,
        });
        expect(response.status).toBe(403);
      }
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('when the picture cannot be had', () => {
    const answer = async (fetcher: ImageFetch) =>
      serveImage(ask(), {
        access: open,
        fetcher,
        background: () => undefined,
      });

    it.each([
      ['is gone', () => new Response('', { status: 404 }), 404],
      ['is refused by its site', () => new Response('', { status: 500 }), 502],
      [
        'is not an image',
        () =>
          new Response('<html>', { headers: { 'content-type': 'text/html' } }),
        415,
      ],
      [
        'is an SVG',
        () =>
          new Response('<svg/>', {
            headers: { 'content-type': 'image/svg+xml' },
          }),
        415,
      ],
      [
        'is too large',
        () =>
          new Response('x', {
            headers: {
              'content-type': 'image/png',
              'content-length': String(50 * 1024 * 1024),
            },
          }),
        413,
      ],
    ])(
      'answers a short error that nobody keeps when it %s',
      async (_n, make, status) => {
        const response = await answer(async () => make());
        expect(response.status).toBe(status);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toContain('text/plain');
      },
    );

    it('answers 502 when its site cannot be reached', async () => {
      const response = await answer(async () => {
        throw new Error('offline');
      });
      expect(response.status).toBe(502);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('answers 400 when it redirects to an address it should not reach', async () => {
      const response = await answer(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'http://127.0.0.1:8080/admin' },
          }),
      );
      expect(response.status).toBe(400);
    });

    it('does not keep a copy of what it could not get', async () => {
      const { cache, stored } = fakeCache();
      const background = jest.fn();
      await serveImage(ask(), {
        access: open,
        cache,
        fetcher: async () => new Response('', { status: 500 }),
        background,
      });
      expect(background).not.toHaveBeenCalled();
      expect(stored).toEqual([]);
    });
  });
});
