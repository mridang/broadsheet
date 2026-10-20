/**
 * @packageDocumentation
 *
 * The pages anyone can see (the public pages in `site.ts`) are the same for
 * every signed-out visitor, so the Worker keeps a copy of each at the edge and
 * answers from it in a few milliseconds, without waking the app. Anyone with a
 * session cookie bypasses this entirely and always gets the live, personal
 * page. A deploy changes the cache key (the version id is part of it), so a new
 * release never serves HTML that points at old, replaced scripts. A copy is not
 * a way round the rate limits: `serve.ts` counts the request first.
 */

import { SITE_NAME } from '../site';
import { nonceOf } from './csp';
import { EDGE_LIMITS } from './extras';
import { replacingHeaders } from './headers';
import { PUBLIC_PAGES } from './site';

/** How long the edge may keep a page before asking the app again. */
export const EDGE_TTL_SECONDS = 300;

/**
 * Whether this request may be answered from (and added to) the edge copy:
 * a plain GET of one of `pages` (the public pages unless told otherwise) from
 * someone with no session.
 */
export function isEdgeCacheable(
  request: Request,
  pages: ReadonlySet<string> = PUBLIC_PAGES,
  sessionCookie: string | undefined = EDGE_LIMITS.sessionCookie,
): boolean {
  if (request.method !== 'GET') {
    return false;
  }
  const url = new URL(request.url);
  if (!pages.has(url.pathname) || url.search) {
    return false;
  }
  if (request.headers.has('authorization')) {
    return false;
  }
  // Any session cookie, valid or not, means "treat as someone's own page".
  const cookie = request.headers.get('cookie') ?? '';
  return sessionCookie === undefined || !cookie.includes(`${sessionCookie}=`);
}

/** The cache key for a page at one release. */
export function edgeCacheKey(request: Request, version: string): Request {
  const { pathname } = new URL(request.url);
  return new Request(
    `https://edge.${SITE_NAME}.invalid/${encodeURIComponent(version)}${pathname}`,
  );
}

/**
 * A copy of the response fit to keep, or null if it isn't (an error, a
 * redirect, something that isn't HTML, or anything that sets a cookie). The
 * copy is marked public so the edge cache accepts it.
 */
export function storableCopy(response: Response): Response | null {
  if (
    response.status !== 200 ||
    response.headers.has('set-cookie') ||
    !(response.headers.get('content-type') ?? '').startsWith('text/html')
  ) {
    return null;
  }
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers: replacingHeaders(response.headers, {
      'Cache-Control': `public, max-age=${EDGE_TTL_SECONDS}`,
    }),
  });
}

/**
 * A cached page with this request's own Content Security Policy nonce in place
 * of the one it was stored with. The copy is shared by every anonymous visitor
 * for several minutes, and a nonce that stays the same for that long is a
 * password everyone knows; so each hit gets a nonce of its own, swapped into the
 * scripts and into the policy header. A page whose policy carries no nonce is
 * returned as it is.
 */
export async function withFreshNonce(
  cached: Response,
  nonce: string,
  csp: string,
): Promise<Response> {
  const old = nonceOf(cached.headers.get('content-security-policy') ?? '');
  if (old === undefined) {
    return cached;
  }
  return new Response((await cached.text()).replaceAll(old, nonce), {
    status: cached.status,
    statusText: cached.statusText,
    headers: replacingHeaders(cached.headers, {
      'Content-Security-Policy': csp,
    }),
  });
}

/** Whether a value can be used as the edge cache: it answers `match` and `put`. */
function isCache(value: unknown): value is Cache {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'match') === 'function' &&
    typeof Reflect.get(value, 'put') === 'function'
  );
}

/** Cloudflare's per-colo cache; absent when running under plain Node. */
export function edgeCache(): Cache | undefined {
  const store: unknown = Reflect.get(globalThis, 'caches');
  const cache: unknown =
    typeof store === 'object' && store !== null
      ? Reflect.get(store, 'default')
      : undefined;
  return isCache(cache) ? cache : undefined;
}
