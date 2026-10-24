/**
 * @packageDocumentation
 *
 * What the image route reaches for in the running Worker: the Images binding,
 * the edge cache and the "run this after the response" hook. Each is looked up
 * when asked for and comes back empty where the runtime has none (plain Node,
 * tests), so the proxy still works there, just without scaling or a cache.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

import { isImagesBinding, type ImagesLike } from '@/lib/images/proxy';
import { ImageSigner } from '@/lib/images/signer';
import type { ImageCache } from '@/core/images/service';

/**
 * A signer keyed by the running Worker's `SESSION_SECRET`, or undefined when
 * there is no secret or no Cloudflare context (tests, builds): with no secret
 * nothing is signed and nothing is accepted, rather than signing with a value
 * anyone could guess.
 */
export function imageSigner(): ImageSigner | undefined {
  try {
    const secret = getCloudflareContext().env.SESSION_SECRET;
    return secret ? new ImageSigner(secret) : undefined;
  } catch {
    return undefined;
  }
}

/** The Images binding, where the deployment has one. */
export function imagesBinding(): ImagesLike | undefined {
  try {
    const binding: unknown = Reflect.get(getCloudflareContext().env, 'IMAGES');
    return isImagesBinding(binding) ? binding : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a value can be used as the edge cache: it answers `match` and `put`. */
function isCache(value: unknown): value is ImageCache {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'match') === 'function' &&
    typeof Reflect.get(value, 'put') === 'function'
  );
}

/** Cloudflare's per-location cache; absent when running under plain Node. */
export function imageCache(): ImageCache | undefined {
  const store: unknown = Reflect.get(globalThis, 'caches');
  const cache: unknown =
    typeof store === 'object' && store !== null
      ? Reflect.get(store, 'default')
      : undefined;
  return isCache(cache) ? cache : undefined;
}

/**
 * Run work after the response has been sent, without blocking it. A failure is
 * logged and swallowed, because storing a copy must never turn a good answer
 * into an error. Outside a Workers request the promise simply runs on its own.
 */
export function runInBackground(work: Promise<unknown>): void {
  const guarded = work.catch((err: unknown) => {
    console.error('image background task failed', err);
  });
  try {
    getCloudflareContext().ctx.waitUntil(guarded);
  } catch {
    // No request context: the promise already runs; nothing to extend.
  }
}
