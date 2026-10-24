/**
 * @packageDocumentation
 *
 * Fetching one picture for the image proxy (see `service.ts` for answering a
 * request): the safe fetch of someone else's file, and the scaling that makes
 * it light. Addresses, widths and the rules for which pictures are ours to
 * proxy are in `address.ts`.
 */

import {
  fetchCapped,
  type FetchFailure,
  type SafeFetcher,
} from '@/lib/safe-fetch';
import { snapWidth } from '@/lib/images/address';

/** The most a picture may weigh before we refuse it. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** How long an original is kept at the edge by the fetch, in seconds. */
const ORIGINAL_KEEP_SECONDS = 7 * 24 * 60 * 60;

/** The fetch function, narrowed to what the proxy needs, so tests can fake it. */
export type ImageFetch = SafeFetcher;

/**
 * The part of Cloudflare's Images binding the proxy uses (scale an image, encode
 * it as WebP), so tests can fake it. The binding needs no zone settings, only
 * the `images` entry in `wrangler.jsonc`.
 */
export interface ImagesLike {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: Readonly<{ width: number; fit: 'scale-down' }>): {
      output(
        options: Readonly<{ format: 'image/webp'; quality: number }>,
      ): Promise<{ response(): Response }>;
    };
  };
}

/** Whether a value is usable as the Images binding: it can take an image as input. */
export function isImagesBinding(value: unknown): value is ImagesLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'input') === 'function'
  );
}

/** What fetching a picture gave: its bytes and type, or why not. */
export type ImageResult =
  | {
      readonly ok: true;
      readonly bytes: ArrayBuffer;
      /** The media type of `bytes`. */
      readonly type: string;
    }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 413 | 415 | 502;
      readonly reason: string;
    };

/** Pictures smaller than this are already light; scaling them gains nothing. */
const SCALE_FROM_BYTES = 24 * 1024;

/** Formats worth scaling. (A GIF may be animated, which scaling would flatten.) */
const SCALABLE = /^image\/(jpeg|jpg|png|webp|avif)$/;

/** The format scaled pictures are sent in: every browser that can show a modern page reads it. */
const SCALED_TYPE = 'image/webp';

/** How hard the scaled picture is compressed (0 to 100). */
const SCALED_QUALITY = 75;

/** The outcome of `work`, or undefined if it threw: a failed step is an answer here, not a crash. */
async function attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch {
    return undefined;
  }
}

/** A refusal to send a picture, with the status to answer and a sentence saying why. */
function refusal(
  status: Extract<ImageResult, { ok: false }>['status'],
  reason: string,
): ImageResult {
  return { ok: false, status, reason };
}

/**
 * The picture scaled down to `width` and encoded as WebP, or undefined when
 * scaling fails or would not make it any smaller. The original is then sent
 * as it is, so a picture is never lost to an optimisation.
 */
async function scaledCopy(
  images: ImagesLike,
  bytes: ArrayBuffer,
  width: number,
): Promise<ArrayBuffer | undefined> {
  const scaled = await attempt(async () => {
    const output = await images
      .input(new Blob([bytes]).stream())
      .transform({ width: snapWidth(width), fit: 'scale-down' })
      .output({ format: SCALED_TYPE, quality: SCALED_QUALITY });
    return output.response().arrayBuffer();
  });
  // Only keep the result if it is really smaller than the original.
  return scaled && scaled.byteLength > 0 && scaled.byteLength < bytes.byteLength
    ? scaled
    : undefined;
}

/** How long the picture's site gets to answer and send the picture, in all. */
const FETCH_TIMEOUT_MS = 8000;

/** What we ask the picture's site for, best format first. */
const ACCEPT_IMAGES = 'image/avif,image/webp,image/apng,image/*;q=0.8';

/** Whether a media type is a raster image: any image except SVG, which can carry script. */
function isRasterImage(mediaType: string): boolean {
  return mediaType.startsWith('image/') && !mediaType.startsWith('image/svg');
}

/** The refusal that answers a fetch that gave no picture. */
function refusalFor(failure: FetchFailure): ImageResult {
  switch (failure.reason) {
    case 'blocked':
      return refusal(400, 'Not a fetchable image address.');
    case 'type':
      return refusal(415, 'That address is not an image.');
    case 'too-large':
      return refusal(413, 'The image is too large.');
    case 'status':
      return failure.status === 404 || failure.status === 410
        ? refusal(404, 'The image is gone.')
        : refusal(502, 'The image site refused.');
    case 'redirects':
    case 'timeout':
    case 'unreachable':
      return refusal(502, 'The image site did not answer.');
  }
}

/**
 * Fetch one picture for the proxy. Only real, reasonably small raster images
 * are accepted: never SVG (which can carry script), never an HTML page. The
 * fetch is the shared safe one (`http/safe-fetch.ts`): the picture is read with
 * a hard byte limit however its site behaves, and a redirect is followed only
 * to another public address. Where the Images binding is available the picture
 * is scaled down to `width` and sent as WebP, typically a tenth of the
 * original's weight; if scaling fails the original is passed through, so a
 * picture is never lost to an optimisation.
 */
export async function fetchImage(
  url: string,
  width: number,
  deps: Readonly<{ fetcher?: ImageFetch; images?: ImagesLike }> = {},
): Promise<ImageResult> {
  const fetched = await fetchCapped(url, {
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    accept: ACCEPT_IMAGES,
    acceptsType: isRasterImage,
    // Cloudflare-only: keep the original at the edge, ignored elsewhere.
    edgeCache: { cacheEverything: true, cacheTtl: ORIGINAL_KEEP_SECONDS },
    fetcher: deps.fetcher,
  });
  if (!fetched.ok) {
    return refusalFor(fetched);
  }
  const { bytes, type } = fetched;
  const scaled =
    deps.images && SCALABLE.test(type) && bytes.byteLength > SCALE_FROM_BYTES
      ? await scaledCopy(deps.images, bytes, width)
      : undefined;
  return scaled
    ? { ok: true, bytes: scaled, type: SCALED_TYPE }
    : { ok: true, bytes, type };
}
