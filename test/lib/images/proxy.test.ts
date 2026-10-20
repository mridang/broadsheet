import { describe, expect, it } from '@jest/globals';

import { snapWidth } from '../../../src/lib/images/address';
import {
  fetchImage,
  isImagesBinding,
  type ImageFetch,
} from '../../../src/lib/images/proxy';
import { SITE_NAME } from '../../../src/lib/site';

const image = (type = 'image/jpeg', headers: Record<string, string> = {}) =>
  new Response('bytes', { headers: { 'content-type': type, ...headers } });
const returning =
  (res: Response): ImageFetch =>
  async () =>
    res;

describe('isImagesBinding', () => {
  it('accepts anything that can take an image as input', () => {
    expect(isImagesBinding({ input: () => undefined })).toBe(true);
  });

  it.each([undefined, null, 'images', {}, { input: 1 }])(
    'refuses %p',
    (value) => {
      expect(isImagesBinding(value)).toBe(false);
    },
  );
});

describe('fetchImage', () => {
  it('passes a photo through with the type its site gave', async () => {
    const result = await fetchImage('https://a.com/x.jpg', 640, {
      fetcher: returning(image()),
    });
    expect(result).toMatchObject({ ok: true, type: 'image/jpeg' });
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe('bytes');
  });

  describe('scaling', () => {
    const big = () =>
      new Response(new Uint8Array(100_000), {
        headers: { 'content-type': 'image/jpeg' },
      });
    const images = (
      out: ArrayBuffer | Error,
      seen: { width?: number } = {},
    ) => ({
      input: () => ({
        transform: (t: { width: number }) => {
          seen.width = t.width;
          return {
            output: async () => {
              if (out instanceof Error) {
                throw out;
              }
              return { response: () => new Response(out) };
            },
          };
        },
      }),
    });

    it('scales a large photo to the width we asked for and sends WebP', async () => {
      const seen: { width?: number } = {};
      const result = await fetchImage('https://a.com/x.jpg', 700, {
        fetcher: returning(big()),
        images: images(new Uint8Array(9_000).buffer, seen),
      });
      expect(seen.width).toBe(snapWidth(700));
      expect(result).toMatchObject({ ok: true, type: 'image/webp' });
      expect(result.ok && result.bytes.byteLength).toBe(9_000);
    });

    it('sends the original when scaling fails', async () => {
      const result = await fetchImage('https://a.com/x.jpg', 640, {
        fetcher: returning(big()),
        images: images(new Error('9412')),
      });
      expect(result).toMatchObject({ ok: true, type: 'image/jpeg' });
      expect(result.ok && result.bytes.byteLength).toBe(100_000);
    });

    it('sends the original when scaling would not make it smaller', async () => {
      const result = await fetchImage('https://a.com/x.jpg', 640, {
        fetcher: returning(big()),
        images: images(new Uint8Array(200_000).buffer),
      });
      expect(result).toMatchObject({ ok: true, type: 'image/jpeg' });
    });

    it('leaves small photos and GIFs alone', async () => {
      let used = false;
      const spy = {
        input: () => {
          used = true;
          throw new Error('should not be called');
        },
      };
      await fetchImage('https://a.com/x.jpg', 640, {
        fetcher: returning(image()),
        images: spy as never,
      });
      await fetchImage('https://a.com/x.gif', 640, {
        fetcher: returning(
          new Response(new Uint8Array(100_000), {
            headers: { 'content-type': 'image/gif' },
          }),
        ),
        images: spy as never,
      });
      expect(used).toBe(false);
    });
  });

  it('refuses an address it should not fetch, without fetching', async () => {
    let called = false;
    const result = await fetchImage('http://127.0.0.1/x.jpg', 640, {
      fetcher: async () => {
        called = true;
        return image();
      },
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(called).toBe(false);
  });

  it.each([
    ['an HTML page', image('text/html'), 415],
    ['an SVG, which can carry script', image('image/svg+xml'), 415],
    [
      'a photo that is too large',
      image('image/png', { 'content-length': String(50 * 1024 * 1024) }),
      413,
    ],
    ['a missing photo', new Response('', { status: 404 }), 404],
    ['a refusal', new Response('', { status: 403 }), 502],
  ])('rejects %s', async (_name, response, status) => {
    expect(
      await fetchImage('https://a.com/x', 640, {
        fetcher: returning(response),
      }),
    ).toMatchObject({
      ok: false,
      status,
    });
  });

  it('reports a site that does not answer', async () => {
    const result = await fetchImage('https://a.com/x.jpg', 640, {
      fetcher: async () => {
        throw new Error('timeout');
      },
    });
    expect(result).toMatchObject({ ok: false, status: 502 });
  });

  describe('the shared safe fetch', () => {
    /** A fetcher that answers each call from `responses` and remembers the calls. */
    function serving(...responses: readonly Response[]) {
      const calls: { url: string; init: Parameters<ImageFetch>[1] }[] = [];
      const fetcher: ImageFetch = async (url, init) => {
        calls.push({ url, init });
        return responses[calls.length - 1] ?? new Response('', { status: 500 });
      };
      return { fetcher, calls };
    }

    it('introduces itself honestly and keeps the original at the edge', async () => {
      const { fetcher, calls } = serving(image());
      await fetchImage('https://a.com/x.jpg', 640, { fetcher });
      const init = calls[0]?.init;
      expect(init?.headers).toEqual(
        expect.objectContaining({
          'User-Agent': expect.stringContaining(SITE_NAME),
        }),
      );
      expect(init?.redirect).toBe('manual');
      expect(init?.cf).toEqual({ cacheEverything: true, cacheTtl: 604_800 });
    });

    it('follows a redirect to another public photo', async () => {
      const { fetcher, calls } = serving(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://cdn.a.com/x.jpg' },
        }),
        image(),
      );
      const result = await fetchImage('https://a.com/x.jpg', 640, { fetcher });
      expect(result.ok).toBe(true);
      expect(calls.map((c) => c.url)).toEqual([
        'https://a.com/x.jpg',
        'https://cdn.a.com/x.jpg',
      ]);
    });

    it.each([
      'http://127.0.0.1:8080/x.jpg',
      'https://a.com:8443/x.jpg',
      'http://169.254.169.254/latest/meta-data',
    ])('refuses a redirect to %s', async (target) => {
      const { fetcher, calls } = serving(
        new Response(null, { status: 302, headers: { Location: target } }),
        image(),
      );
      expect(
        await fetchImage('https://a.com/x.jpg', 640, { fetcher }),
      ).toMatchObject({ ok: false, status: 400 });
      expect(calls).toHaveLength(1);
    });

    it('answers 502 for a site that redirects in circles', async () => {
      const loop = () =>
        new Response(null, { status: 302, headers: { Location: '/again' } });
      const { fetcher } = serving(loop(), loop(), loop(), loop(), loop());
      expect(
        await fetchImage('https://a.com/x.jpg', 640, { fetcher }),
      ).toMatchObject({ ok: false, status: 502 });
    });

    it('refuses a body with no declared length that runs past 10 MB, and drops it', async () => {
      const state = { pulls: 0, cancelled: false };
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          state.pulls += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          state.cancelled = true;
        },
      });
      const { fetcher } = serving(
        new Response(endless, { headers: { 'content-type': 'image/jpeg' } }),
      );
      expect(
        await fetchImage('https://a.com/x.jpg', 640, { fetcher }),
      ).toMatchObject({ ok: false, status: 413 });
      expect(state.cancelled).toBe(true);
      // Ten megabytes and the one that broke the limit, not an endless pull.
      expect(state.pulls).toBeLessThan(14);
    });

    it('accepts a body of exactly 10 MB', async () => {
      const { fetcher } = serving(
        new Response(new Uint8Array(10 * 1024 * 1024), {
          headers: { 'content-type': 'image/jpeg' },
        }),
      );
      expect(
        (await fetchImage('https://a.com/x.jpg', 640, { fetcher })).ok,
      ).toBe(true);
    });

    it('says the image is gone for a 410 as well', async () => {
      const { fetcher } = serving(new Response('', { status: 410 }));
      expect(
        await fetchImage('https://a.com/x.jpg', 640, { fetcher }),
      ).toMatchObject({ ok: false, status: 404 });
    });
  });
});
