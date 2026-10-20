/**
 * @packageDocumentation
 *
 * Fetching things from other people's websites, safely. Recipe import fetches
 * the pages people paste links to, and the cover proxy fetches the photos those
 * recipes point at. The address always comes from outside, so both go through
 * this one module, which makes three promises:
 *
 *   - it only talks to public web addresses ({@link isPublicWebUrl}), and
 *     checks again at every redirect, so a public site cannot bounce us to a
 *     port, an IP address or an internal name;
 *   - it never holds more than the caller's byte limit, however the other side
 *     behaves (a declared length is believed only as far as it is checked, a
 *     body that runs on is cut off and the connection dropped);
 *   - it only accepts the kind of content the caller asked for, and gives up
 *     after the caller's time limit, the whole exchange included.
 *
 * It introduces itself with one honest `User-Agent` that says who to contact.
 */

import { SITE_NAME, SITE_URL } from '../site';
import { parseUrl } from '../util/url';

/**
 * Who we say we are to the sites we fetch from. A site operator who sees us in
 * their logs can find out what we are and where to complain.
 */
export const USER_AGENT = `${SITE_NAME}/1.0 (+${SITE_URL})`;

/** The longest address we will follow; real links are far shorter. */
const MAX_URL_LENGTH = 2048;

/** Name endings that are not on the public web (private networks, reserved names). */
const NOT_PUBLIC =
  /\.(local|localhost|localdomain|internal|intranet|private|lan|home|corp|test|invalid|example|arpa)$/;

/**
 * Whether an address is a public web address we are willing to fetch: http or
 * https on the usual ports, with a real hostname. Not an IP address (of any
 * kind), not `localhost`, not an internal or reserved name, no login in the
 * address. This keeps the fetcher from being aimed at anything inside a
 * network.
 */
export function isPublicWebUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) {
    return false;
  }
  const url = parseUrl(value);
  if (!url) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  // `localhost.` is the same host as `localhost`.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return !(
    !host.includes('.') ||
    host.startsWith('[') ||
    /^[\d.]+$/.test(host) ||
    NOT_PUBLIC.test(host)
  );
}

/** Cloudflare's hint to keep the fetched original at the edge (ignored by other runtimes). */
export type EdgeCacheHint = {
  readonly cacheEverything: boolean;
  readonly cacheTtl: number;
};

/** Request options plus Cloudflare's `cf` extension, which other runtimes ignore. */
export type SafeRequestInit = RequestInit & {
  readonly cf?: EdgeCacheHint | undefined;
};

/** The fetch function, narrowed to what this module needs, so tests can fake it. */
export type SafeFetcher = (
  url: string,
  init: SafeRequestInit,
) => Promise<Response>;

/** The real `fetch`, looked up when called so a test can replace the global. */
const realFetch: SafeFetcher = (url, init) => fetch(url, init);

/** How to fetch: the limits, and what is acceptable. */
export interface CappedFetchOptions {
  /** The most body bytes to read. */
  readonly maxBytes: number;
  /** Give up after this long, counting every redirect and the body. */
  readonly timeoutMs: number;
  /** The `Accept` header to send. */
  readonly accept: string;
  /**
   * Whether a response with this media type (lowercase, parameters removed, an
   * empty string when the site did not say) is wanted. Anything else is refused
   * before its body is read.
   */
  readonly acceptsType: (mediaType: string) => boolean;
  /** How many redirects to follow (default 3). */
  readonly maxRedirects?: number;
  /**
   * What to do with a body longer than `maxBytes`: refuse it (the default), or
   * keep its first `maxBytes` bytes. Truncating suits a page whose useful part
   * comes early; a photo cut short is useless.
   */
  readonly overflow?: 'reject' | 'truncate';
  /** Keep the original at the edge (Cloudflare only). */
  readonly edgeCache?: EdgeCacheHint;
  /** The function that fetches; the real `fetch` when left out. */
  readonly fetcher?: SafeFetcher;
}

/** Why a fetch gave nothing. */
export type FetchFailure =
  | { readonly reason: 'blocked' }
  | { readonly reason: 'unreachable' }
  | { readonly reason: 'timeout' }
  | { readonly reason: 'redirects' }
  | { readonly reason: 'type' }
  | { readonly reason: 'too-large' }
  | { readonly reason: 'status'; readonly status: number };

/** What a capped fetch came to: the body, or why there is none. */
export type CappedFetchResult =
  | {
      readonly ok: true;
      /** The body, at most `maxBytes` long. */
      readonly bytes: ArrayBuffer;
      /** The media type the site declared (lowercase, no parameters). */
      readonly type: string;
      /** The address finally fetched, after any redirects. */
      readonly url: string;
      /** Whether the body was longer than `maxBytes` and was cut off. */
      readonly truncated: boolean;
    }
  | ({ readonly ok: false } & FetchFailure);

/** How many separate pieces a body may arrive in (a body dribbled byte by byte is turned away). */
const MAX_CHUNKS = 4096;

/** The statuses that point somewhere else. */
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** A refusal. */
function refuse(failure: FetchFailure): CappedFetchResult {
  return { ok: false, ...failure };
}

/** Drop a response we are not going to read, so the connection can be reused or closed. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** The media type of a response: lowercase, without parameters, empty when absent. */
function mediaTypeOf(response: Response): string {
  const [essence = ''] = (response.headers.get('content-type') ?? '').split(
    ';',
  );
  return essence.trim().toLowerCase();
}

/** What reading a body gave. */
interface Drained {
  readonly chunks: readonly Uint8Array[];
  readonly truncated: boolean;
}

/**
 * Read pieces until the body ends or `remaining` bytes are used up. On running
 * over, the connection is dropped (the reader cancelled) and what fits is kept
 * when `overflow` is `truncate`.
 */
async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  remaining: number,
  overflow: 'reject' | 'truncate',
  chunks: readonly Uint8Array[] = [],
): Promise<Drained> {
  const { done, value } = await reader.read();
  if (done) {
    return { chunks, truncated: false };
  }
  if (value.byteLength > remaining || chunks.length >= MAX_CHUNKS) {
    await reader.cancel().catch(() => undefined);
    return {
      chunks:
        overflow === 'truncate'
          ? [...chunks, value.subarray(0, Math.max(0, remaining))]
          : chunks,
      truncated: true,
    };
  }
  return drain(reader, remaining - value.byteLength, overflow, [
    ...chunks,
    value,
  ]);
}

/** Whether the site says, before sending the body, that it is longer than `maxBytes`. */
function declaredTooLarge(response: Response, maxBytes: number): boolean {
  const declared = response.headers.get('content-length');
  return declared !== null && Number(declared) > maxBytes;
}

/**
 * Whether a piece of a body sits in an ordinary `ArrayBuffer` (it always does:
 * the network never hands out shared memory). Lets the pieces be handed to
 * `Blob`, which only takes those, without copying them.
 */
function isPlainBytes(chunk: Uint8Array): chunk is Uint8Array<ArrayBuffer> {
  return chunk.buffer instanceof ArrayBuffer;
}

/** Everything one fetch needs, so the walk over redirects passes it along as one value. */
interface Plan {
  readonly options: CappedFetchOptions;
  readonly signal: AbortSignal;
}

/** Fetch one address, following redirects (checking each) while hops remain. */
async function fetchHop(
  url: string,
  plan: Plan,
  hopsLeft: number,
): Promise<CappedFetchResult> {
  const { options, signal } = plan;
  if (!isPublicWebUrl(url)) {
    return refuse({ reason: 'blocked' });
  }
  const fetcher = options.fetcher ?? realFetch;
  const response = await fetcher(url, {
    headers: { Accept: options.accept, 'User-Agent': USER_AGENT },
    // Redirects are followed here, one at a time, so that every address we
    // end up at has been checked.
    redirect: 'manual',
    signal,
    cf: options.edgeCache,
  });

  if (REDIRECTS.has(response.status)) {
    await discard(response);
    const next = parseUrl(response.headers.get('location') ?? '', url);
    if (!next) {
      return refuse({ reason: 'redirects' });
    }
    return hopsLeft > 0
      ? fetchHop(next.href, plan, hopsLeft - 1)
      : refuse({ reason: 'redirects' });
  }
  if (!response.ok) {
    await discard(response);
    return refuse({ reason: 'status', status: response.status });
  }
  const type = mediaTypeOf(response);
  if (!options.acceptsType(type)) {
    await discard(response);
    return refuse({ reason: 'type' });
  }
  const overflow = options.overflow ?? 'reject';
  if (overflow === 'reject' && declaredTooLarge(response, options.maxBytes)) {
    await discard(response);
    return refuse({ reason: 'too-large' });
  }
  const { chunks, truncated } = response.body
    ? await drain(response.body.getReader(), options.maxBytes, overflow)
    : { chunks: [], truncated: false };
  if (truncated && overflow === 'reject') {
    return refuse({ reason: 'too-large' });
  }
  return {
    ok: true,
    bytes: await new Blob(chunks.filter(isPlainBytes)).arrayBuffer(),
    type,
    url,
    truncated,
  };
}

/**
 * Fetch a public web address and read at most `maxBytes` of what it sends.
 * Never throws: every way it can go wrong is a {@link FetchFailure}, so the
 * caller decides what a failure means for it.
 */
export async function fetchCapped(
  url: string,
  options: CappedFetchOptions,
): Promise<CappedFetchResult> {
  const signal = AbortSignal.timeout(options.timeoutMs);
  try {
    return await fetchHop(url, { options, signal }, options.maxRedirects ?? 3);
  } catch {
    return refuse({ reason: signal.aborted ? 'timeout' : 'unreachable' });
  }
}
