import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

/** The secret the mocked Worker holds; the route signs and checks with it. */
const SECRET = 'test-secret';

/** The Cloudflare bindings the mocked context carries, and the work it was asked to finish later. */
const context = {
  env: {} as Record<string, unknown>,
  waiting: [] as Promise<unknown>[],
};

jest.unstable_mockModule('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({
    env: context.env,
    ctx: { waitUntil: (work: Promise<unknown>) => context.waiting.push(work) },
  }),
}));

// Everything that reaches the image package is imported after the mock: the
// barrel pulls in the Cloudflare runtime, so loading it (directly, or via
// domain/images/site) before the mock would bind the real context accessor.
const { ImageSigner } = await import('@/lib/cloudflare/images/server');
const { ALLOWED_HOSTS, ALLOWED_WIDTHS, DEFAULT_WIDTH } =
  await import('@/domain/images/site');
const { GET } = await import('@/app/img/route');
const signer = new ImageSigner(SECRET);

const PHOTO = `https://${ALLOWED_HOSTS?.[0] ?? 'photos.example.org'}/soup.jpg`;
const WIDTH = ALLOWED_WIDTHS[0] ?? DEFAULT_WIDTH;

const realFetch = global.fetch;
const realCaches = Reflect.get(globalThis, 'caches');
let fetched: string[];

/** Make every fetch answer with a fresh response from `respond`. */
function serving(respond: () => Response): void {
  global.fetch = (async (url: string) => {
    fetched.push(String(url));
    return respond();
  }) as unknown as typeof fetch;
}

/** A small JPEG response. */
const jpeg = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'image/jpeg' },
  });

/** A request for a picture, signed the way the pages sign one. */
const ask = async (url = PHOTO, width: string | number = WIDTH) => {
  const sig = encodeURIComponent(await signer.sign(url));
  return GET(
    new Request(
      `https://app.test/img?url=${encodeURIComponent(url)}&w=${width}&sig=${sig}`,
    ),
  );
};

beforeEach(() => {
  context.env = { SESSION_SECRET: SECRET };
  context.waiting = [];
  fetched = [];
  serving(jpeg);
  Reflect.set(globalThis, 'caches', undefined);
});

afterEach(() => {
  global.fetch = realFetch;
  Reflect.set(globalThis, 'caches', realCaches);
});

describe('GET /img', () => {
  it('sends a picture sealed and kept by the browser for good', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(
      /^public, max-age=\d+, s-maxage=\d+, immutable$/,
    );
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-site');
    expect(res.headers.get('etag')).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(fetched).toEqual([PHOTO]);
  });

  it('answers 403, without fetching, for a wrong or missing signature', async () => {
    const bad = `https://app.test/img?url=${encodeURIComponent(PHOTO)}&w=${WIDTH}&sig=nope`;
    expect((await GET(new Request(bad))).status).toBe(403);
    const none = `https://app.test/img?url=${encodeURIComponent(PHOTO)}&w=${WIDTH}`;
    expect((await GET(new Request(none))).status).toBe(403);
    expect(fetched).toEqual([]);
  });

  it('answers 403 when the Worker has no secret to check signatures with', async () => {
    context.env = {};
    expect((await ask()).status).toBe(403);
    expect(fetched).toEqual([]);
  });

  it('answers 400 for an address that is not a public image, and for none', async () => {
    expect((await ask('http://127.0.0.1/x.png')).status).toBe(400);
    expect((await ask('file:///etc/passwd')).status).toBe(400);
    expect((await GET(new Request('https://app.test/img?w=640'))).status).toBe(
      400,
    );
    expect(fetched).toEqual([]);
  });

  it.each([
    ['gone', () => new Response('', { status: 404 })],
    ['failing', () => new Response('', { status: 500 })],
    [
      'not an image',
      () =>
        new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    ],
  ])('answers 204 for a picture that is %s', async (_n, make) => {
    serving(make);
    const res = await ask();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
  });

  it('scales a large picture with the Images binding, to the snapped width, and sends WebP', async () => {
    const widths: number[] = [];
    context.env['IMAGES'] = {
      input: () => ({
        transform: (options: { width: number }) => {
          widths.push(options.width);
          return {
            output: async () => ({
              response: () => new Response(new Uint8Array([9])),
            }),
          };
        },
      }),
    };
    serving(
      () =>
        new Response(new Uint8Array(100_000), {
          headers: { 'content-type': 'image/jpeg' },
        }),
    );
    const res = await ask(PHOTO, 1);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(widths).toEqual([Math.min(...ALLOWED_WIDTHS)]);
  });

  it('sends the original as it is when the deployment has no Images binding', async () => {
    serving(
      () =>
        new Response(new Uint8Array(100_000), {
          headers: { 'content-type': 'image/jpeg' },
        }),
    );
    const res = await ask();
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(100_000);
  });

  describe('with an edge cache', () => {
    /** A cache that holds what it is given. */
    function installCache(initial?: Response) {
      const puts: string[] = [];
      Reflect.set(globalThis, 'caches', {
        default: {
          match: async () => initial,
          put: async (key: Request) => {
            puts.push(key.url);
          },
        },
      });
      return puts;
    }

    it('answers from the cache without fetching', async () => {
      installCache(
        new Response('cached', {
          headers: { 'content-type': 'image/webp', etag: '"v1"' },
        }),
      );
      const res = await ask();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('cached');
      expect(fetched).toEqual([]);
    });

    it('keeps a copy of a picture it fetched, after the response is sent', async () => {
      const puts = installCache();
      expect((await ask()).status).toBe(200);
      await Promise.all(context.waiting);
      expect(puts).toEqual([
        `https://images.invalid/${WIDTH}/${encodeURIComponent(PHOTO)}`,
      ]);
    });
  });
});
