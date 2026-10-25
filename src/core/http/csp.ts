/**
 * @packageDocumentation
 *
 * The Content Security Policy: the browser's own list of what a page may load
 * and run. It is what stops a script injected into a page (through some future
 * bug) from running at all.
 *
 * Scripts are allowed only if they carry this response's one-time number (the
 * nonce), which Next.js puts on the scripts and styles it writes when it finds
 * the nonce in the policy on the incoming request. `strict-dynamic` then lets
 * those scripts load the others they need. Nothing else may run, and nothing
 * may be framed, embedded or sent anywhere but this site.
 */

import { bytesToBase64 } from '@/utils/base64';
import { replacingHeaders } from './headers';
import { CSP_REPORT_DIRECTIVES } from './reporting';
import { EXTRA_DIRECTIVES, EXTRA_IMG_SOURCES } from './site';

/** A fresh, unguessable nonce: 16 random bytes, base64. */
export function newNonce(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/** Which kind of page a policy is for: an ordinary one, or the approval screen. */
export type CspSurface = 'site' | 'approval';

/**
 * The policy for one response, carrying that response's nonce.
 *
 * The approval screen (`approval`) differs in two ways. It may not be framed by
 * anyone, this site included (`frame-ancestors 'none'`). And it names no
 * `form-action`: its form posts to our own consent endpoint, which answers with a
 * redirect to the *client's* address (a web page, a localhost port, an app's own
 * scheme). Browsers check a form's redirects against `form-action`, so listing
 * `'self'` there makes them refuse to send the person back to the app they just
 * approved. Where the form is allowed to post is not what protects the page
 * (the consent endpoint is protected by its own same-origin and CSRF checks),
 * so the directive is left out rather than made so wide it means nothing.
 */
export function buildCsp(nonce: string, surface: CspSurface = 'site'): string {
  const approval = surface === 'approval';
  return [
    // Deny anything not named below; every kind of load the site needs is listed.
    "default-src 'none'",
    // `'self'` only matters to browsers too old to know strict-dynamic.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Pictures come from this site; the few other places the app shows a
    // picture from are named in `site.ts`.
    ['img-src', "'self'", 'data:', ...EXTRA_IMG_SOURCES].join(' '),
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    ...(approval ? [] : ["form-action 'self'"]),
    `frame-ancestors '${approval ? 'none' : 'self'}'`,
    'upgrade-insecure-requests',
    // Directives only this app adds, if any (see `site.ts`).
    ...EXTRA_DIRECTIVES,
    ...CSP_REPORT_DIRECTIVES,
  ].join('; ');
}

/**
 * Which policy a path gets. The approval screen may not be framed by anyone,
 * not even this site, and must let the browser follow the redirect back to the
 * assistant, so it has a policy of its own; every other page has the site's.
 */
export function cspSurfaceFor(pathname: string): CspSurface {
  return pathname === '/oauth/authorize' ? 'approval' : 'site';
}

/** The nonce in a policy, if it carries one. */
export function nonceOf(csp: string): string | undefined {
  return /'nonce-([^']+)'/.exec(csp)?.[1];
}

/**
 * The headers to forward to the app: the caller's own, with the policy and the
 * nonce set to ours. `set`, not append: a policy or nonce header sent by the
 * caller must be replaced, or Next.js could read the caller's nonce instead of
 * ours and render a page (that may then be cached) whose scripts our policy
 * refuses.
 */
export function forwardedHeaders(
  incoming: Headers,
  csp: string,
  nonce: string,
): Headers {
  return replacingHeaders(incoming, {
    'content-security-policy': csp,
    'x-nonce': nonce,
  });
}
