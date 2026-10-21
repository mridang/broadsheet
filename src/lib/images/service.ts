/**
 * @packageDocumentation
 *
 * Answering one request for a picture: from the edge cache when it has the
 * picture, otherwise by fetching it (see `proxy.ts`), keeping a copy at the
 * edge, and sending it on. The cache, the Images binding, the "run this later"
 * hook and the app's access rules (`access.ts`) are passed in, so a test can
 * use small fakes.
 *
 * A picture is fully determined by its address and width, so the browser may
 * keep it for a month without asking again and the edge keeps its copy for a
 * week. Every answer carries the same headers, from the edge copy or not. A
 * request that cannot be served gets a problem document (RFC 9457), like the
 * rest of the API, that nobody caches.
 */

import { problems } from '../api/problem';
import { isPublicWebUrl } from '../http/safe-fetch';
import { isAllowedHost, snapWidth } from './address';
import { fetchImage, type ImageFetch, type ImagesLike } from './proxy';
import { DEFAULT_WIDTH } from './site';

/** The two cache operations the service uses. */
export type ImageCache = Pick<Cache, 'match' | 'put'>;

/** Who may have which picture; the rules differ from app to app (see `access.ts`). */
export interface ImageAccess {
  /**
   * Asked first, of every request. A refusal is sent as it is; undefined lets
   * the request go on.
   */
  authenticate(request: Request): Promise<Response | undefined>;
  /** Whether `signature` proves this server chose to show the picture at `url`. */
  signatureValid(url: string, signature: string | null): boolean;
  /**
   * Whether the caller may have the proxy fetch `url`. Asked only when the
   * edge has no copy, since a copy costs nothing and is a public picture anyway.
   */
  mayFetch(url: string): Promise<boolean>;
}

/** What the service reaches out to. */
export interface ImageServiceDeps {
  /** The edge cache, where the runtime has one. */
  readonly cache?: ImageCache;
  /** The Images binding, where the deployment has one. */
  readonly images?: ImagesLike;
  /** Fetch the picture from its site; the real `fetch` when left out. */
  readonly fetcher?: ImageFetch;
  /** The app's access rules. */
  readonly access: ImageAccess;
  /** Run work after the response is sent (storing the copy). */
  readonly background: (work: Promise<unknown>) => void;
}

/** How long a browser keeps a picture without asking again, in seconds (30 days). */
export const BROWSER_SECONDS = 30 * 24 * 60 * 60;

/** How long the edge keeps its copy, in seconds (7 days). */
export const EDGE_SECONDS = 7 * 24 * 60 * 60;

/** The longest address the proxy accepts. */
const MAX_URL_LENGTH = 2048;

/** The key a picture is kept under. It leaves out cookies, so everyone shares one copy. */
export function imageCacheKey(width: number, url: string): Request {
  return new Request(
    `https://images.invalid/${width}/${encodeURIComponent(url)}`,
  );
}

/** A refusal: a problem document that no cache keeps. */
export function refuse(status: 400 | 403, message: string): Response {
  const refusal =
    status === 400 ? problems.badRequest(message) : problems.forbidden(message);
  refusal.headers.set('X-Content-Type-Options', 'nosniff');
  return refusal;
}

/**
 * What a page gets for a picture the other site cannot give us (gone, refusing,
 * not a picture, too large): nothing, with a status that is not an error, so
 * the page shows its own fallback without the browser logging a failed request.
 * Kept for an hour so a dead picture is not asked for again on every page.
 */
export function unavailable(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** A picture's bytes and what is known about them. */
interface Picture {
  readonly bytes: ArrayBuffer;
  readonly type: string;
  /** The validator of the bytes, quoted. */
  readonly etag: string;
}

/** The headers every picture we send carries. */
export function imageHeaders(type: string, etag: string): Headers {
  return new Headers({
    'Content-Type': type,
    ETag: etag,
    // The address and width fully determine the picture, so the browser can
    // keep it for good; `s-maxage` is the same for any shared cache in front.
    'Cache-Control': `public, max-age=${BROWSER_SECONDS}, s-maxage=${EDGE_SECONDS}, immutable`,
    'Content-Disposition': 'inline',
    // A sealed, script-free image: if one were ever opened as a page, it could
    // do nothing.
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
}

/** The first 16 bytes of the SHA-256 of `bytes` as a quoted entity tag. */
async function etagOf(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex}"`;
}

/** Whether an `If-None-Match` header names `etag` (or everything). */
function isCurrent(ifNoneMatch: string | null, etag: string): boolean {
  return (
    ifNoneMatch !== null &&
    ifNoneMatch
      .split(',')
      .map((tag) => tag.trim().replace(/^W\//, ''))
      .some((tag) => tag === '*' || tag === etag)
  );
}

/** The answer to a request: the picture (200), or 304 when the browser's copy is current. */
function respond(request: Request, picture: Picture): Response {
  const headers = imageHeaders(picture.type, picture.etag);
  return isCurrent(request.headers.get('if-none-match'), picture.etag)
    ? new Response(null, { status: 304, headers })
    : new Response(picture.bytes, { status: 200, headers });
}

/** What the edge keeps: the bytes with their type, validator and the edge's own time to live. */
function storedCopy(picture: Picture): Response {
  return new Response(picture.bytes, {
    headers: {
      'Content-Type': picture.type,
      ETag: picture.etag,
      'Cache-Control': `public, max-age=${EDGE_SECONDS}`,
    },
  });
}

/** The picture in a stored copy, or undefined when the copy is not one we made. */
async function pictureFrom(copy: Response): Promise<Picture | undefined> {
  const type = copy.headers.get('content-type');
  const etag = copy.headers.get('etag');
  return type && etag
    ? { bytes: await copy.arrayBuffer(), type, etag }
    : undefined;
}

/**
 * The response for a request for a picture: `GET /api/img?url=<address>&w=<width>`
 * (and `&sig=` where the app signs its addresses). The picture (200, or 304
 * when the browser's copy is current), 400 for a missing or non-public
 * address, 403 when the app does not allow it, 404 when its site no longer has
 * it, 413 when it is too large, 415 when it is not a raster image and 502 when
 * its site fails.
 */
export async function serveImage(
  request: Request,
  deps: ImageServiceDeps,
): Promise<Response> {
  const { access, cache } = deps;
  const early = await access.authenticate(request);
  if (early) {
    return early;
  }
  const params = new URL(request.url).searchParams;
  const url = params.get('url') ?? '';
  if (url.length === 0 || url.length > MAX_URL_LENGTH || !isPublicWebUrl(url)) {
    return refuse(400, 'url: must be a public http(s) image address.');
  }
  if (!isAllowedHost(url) || !access.signatureValid(url, params.get('sig'))) {
    return refuse(403, 'That image is not available through this site.');
  }
  const width = snapWidth(Number(params.get('w')) || DEFAULT_WIDTH);
  // The edge cache is shared across people, which is fine: the picture is public.
  const key = imageCacheKey(width, url);
  const hit = await cache?.match(key);
  const kept = hit ? await pictureFrom(hit) : undefined;
  if (kept) {
    return respond(request, kept);
  }
  if (!(await access.mayFetch(url))) {
    return refuse(403, 'That image is not available to you.');
  }
  const result = await fetchImage(url, width, {
    images: deps.images,
    fetcher: deps.fetcher,
  });
  if (!result.ok) {
    // An address that leads somewhere it should not is refused outright; any
    // other failure is the other site's, and is answered quietly.
    return result.status === 400
      ? refuse(result.status, result.reason)
      : unavailable();
  }
  const picture: Picture = {
    bytes: result.bytes,
    type: result.type,
    etag: await etagOf(result.bytes),
  };
  if (cache) {
    deps.background(cache.put(key, storedCopy(picture)));
  }
  return respond(request, picture);
}
