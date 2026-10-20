import { afterEach, describe, expect, it, jest } from '@jest/globals';

/** What the mocked Cloudflare context holds; null means there is no context at all. */
const context: { current: { env: object; ctx: object } | null } = {
  current: null,
};

jest.unstable_mockModule('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (context.current === null) {
      throw new Error('no context');
    }
    return context.current;
  },
}));

const { imageCache, imagesBinding, runInBackground } =
  await import('../../../src/lib/images/runtime');

const realCaches = Reflect.get(globalThis, 'caches');

afterEach(() => {
  context.current = null;
  Reflect.set(globalThis, 'caches', realCaches);
});

describe('imagesBinding', () => {
  it('is the IMAGES binding of the Cloudflare context', () => {
    const binding = { input: () => undefined };
    context.current = { env: { IMAGES: binding }, ctx: {} };
    expect(imagesBinding()).toBe(binding);
  });

  it('is empty when the deployment has none, or the value is not one', () => {
    context.current = { env: {}, ctx: {} };
    expect(imagesBinding()).toBeUndefined();
    context.current = { env: { IMAGES: 'nope' }, ctx: {} };
    expect(imagesBinding()).toBeUndefined();
  });

  it('is empty, not an error, outside a Cloudflare context', () => {
    expect(imagesBinding()).toBeUndefined();
  });
});

describe('imageCache', () => {
  it("is the runtime's default cache", () => {
    const cache = { match: async () => undefined, put: async () => undefined };
    Reflect.set(globalThis, 'caches', { default: cache });
    expect(imageCache()).toBe(cache);
  });

  it.each([undefined, {}, { default: {} }, { default: { match: () => 1 } }])(
    'is empty where the runtime has none (%p)',
    (store) => {
      Reflect.set(globalThis, 'caches', store);
      expect(imageCache()).toBeUndefined();
    },
  );
});

describe('runInBackground', () => {
  it('asks the runtime to keep the Worker alive for the work', async () => {
    const waiting: Promise<unknown>[] = [];
    context.current = {
      env: {},
      ctx: { waitUntil: (work: Promise<unknown>) => waiting.push(work) },
    };
    runInBackground(Promise.resolve());
    expect(waiting).toHaveLength(1);
    await expect(waiting[0]).resolves.toBeUndefined();
  });

  it('lets the work run on its own outside a Cloudflare context', async () => {
    let done = false;
    runInBackground(
      Promise.resolve().then(() => {
        done = true;
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it('logs work that fails rather than letting it escape', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    runInBackground(Promise.reject(new Error('boom')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toHaveBeenCalledWith(
      'image background task failed',
      expect.any(Error),
    );
    log.mockRestore();
  });
});
