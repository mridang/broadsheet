/**
 * @packageDocumentation
 *
 * The response headers every page and API answer carries: browser security
 * settings and caching rules. They are applied in one place, the Worker entry
 * (`src/worker.ts`), so a new route can't forget them. Static files bypass the
 * Worker, so `public/_headers` repeats the same security headers for them (a
 * test keeps the two in step).
 */

import { REPORTING_ENDPOINTS } from '@/core/http/reporting';
import { OPEN_FILES, PUBLIC_PAGES, RARELY_CHANGING } from '@/core/http/site';

/** Security headers for every response. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Never let a browser guess a different content type for a response.
  'X-Content-Type-Options': 'nosniff',
  // Send other sites only our origin, and nothing at all on a downgrade.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Talk to HTTPS only, for two years, on this host and its subdomains.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  // Nothing here needs the camera, microphone, location or payments.
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  // Only this site may frame it (the sign-in approval page forbids even that),
  // and keep forms, <base> and plugins on a short leash.
  'Content-Security-Policy':
    "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Frame-Options': 'SAMEORIGIN',
  // Keep other windows from reaching into this one.
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** The `Cross-Origin-Resource-Policy` for a path. */
export function resourcePolicyFor(pathname: string): string {
  return OPEN_FILES.test(pathname) ? 'cross-origin' : 'same-site';
}

/**
 * The `Cross-Origin-Opener-Policy` for a path. Everywhere but one place it cuts
 * other windows off from this one. The approval screen is the exception: an
 * assistant that opens it in a popup finishes sign-in through the window that
 * opened it, and `same-origin` would sever that link the moment the popup
 * lands here. The screen holds nothing a window that opened it could read.
 */
export function openerPolicyFor(pathname: string): string {
  return pathname === '/oauth/authorize'
    ? 'unsafe-none'
    : (SECURITY_HEADERS['Cross-Origin-Opener-Policy'] ?? 'same-origin');
}

/** One response header: its name and value. */
type HeaderPair = [string, string];

/**
 * A copy of `headers` with each of `replacements` set, replacing any header of
 * the same name. The original is left as it was (a `Response` from the app is
 * read-only anyway).
 */
export function replacingHeaders(
  headers: Headers,
  replacements: Readonly<Record<string, string>>,
): Headers {
  const names = new Set(Object.keys(replacements).map((n) => n.toLowerCase()));
  const kept: HeaderPair[] = [...headers].filter(([name]) => !names.has(name));
  return new Headers([...kept, ...Object.entries(replacements)]);
}

/** Tells crawlers not to index a page or follow its links. */
const NOINDEX: HeaderPair = ['X-Robots-Tag', 'noindex, nofollow'];

/** Cache rules for the few responses that want something other than the default. */
function cacheControlFor(pathname: string, response: Response): string | null {
  if (RARELY_CHANGING.has(pathname)) {
    // Rarely changes, and a stale copy is harmless.
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }
  const type = response.headers.get('content-type') ?? '';
  const isPage = type.startsWith('text/html');
  const ours = !pathname.startsWith('/api/') && !pathname.startsWith('/oauth/');
  if (isPage && ours) {
    // Pages are personal, so a shared cache must not keep them; "no-cache"
    // (rather than Next's "no-store") still lets the back button restore a page
    // instantly while the browser checks for a newer one.
    return 'private, no-cache';
  }
  return null;
}

/**
 * The response with the site's security headers added and, where it has one, a
 * better cache rule. Responses that set their own security headers (the
 * sign-in approval page) keep them.
 */
export function applyResponseHeaders(
  request: Request,
  response: Response,
): Response {
  // A redirect or an upgrade has no headers we may change, and no body to protect.
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const { pathname } = new URL(request.url);
  const present = response.headers;
  const leftAlone = PUBLIC_PAGES.has(pathname) || OPEN_FILES.test(pathname);
  const candidates: HeaderPair[] = [
    ...Object.entries(SECURITY_HEADERS).map(
      ([name, value]): HeaderPair => [
        name,
        name === 'Cross-Origin-Opener-Policy'
          ? openerPolicyFor(pathname)
          : value,
      ],
    ),
    ['Cross-Origin-Resource-Policy', resourcePolicyFor(pathname)],
    // Tells the browser where the policies' `report-to csp-endpoint` reports go.
    ['Reporting-Endpoints', REPORTING_ENDPOINTS],
    // Whatever the page itself says, tell crawlers not to index or follow it.
    // (The files other sites are meant to fetch, such as the sitemap and
    // robots.txt, are left alone: marking them noindex would only confuse.)
    ...(leftAlone ? [] : [NOINDEX]),
  ];
  // Added only where the response has not set its own.
  const defaults = candidates.filter(([name]) => !present.has(name));
  // A cache rule from here replaces whatever the response said.
  const cache = cacheControlFor(pathname, response);
  const replacing: HeaderPair[] = cache ? [['Cache-Control', cache]] : [];
  const kept: HeaderPair[] = [...present].filter(
    ([name]) => replacing.length === 0 || name !== 'cache-control',
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers([...kept, ...defaults, ...replacing]),
  });
}
