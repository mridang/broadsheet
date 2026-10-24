/**
 * @packageDocumentation
 *
 * Cross-site request forgery check for requests that change state. The session
 * cookie is `SameSite=Lax`, which already keeps it off cross-site POSTs; this is
 * a second layer that refuses a request made from another site.
 *
 * Browsers say where a request came from in `Sec-Fetch-Site` (reliable, and
 * not affected by referrer policy) and `Origin`. A page served with
 * `Referrer-Policy: no-referrer` — as the approval screen is — sends
 * `Origin: null` on its own same-site form posts, so `null` must not be
 * treated as hostile when `Sec-Fetch-Site` says the request is same-origin.
 */

/** Whether a form post came from our own pages. */
export function isSameOriginPost(headers: Headers, origin: string): boolean {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite) {
    return fetchSite === 'same-origin';
  }
  // Older browsers: fall back to Origin, which must match when sent.
  const sentFrom = headers.get('origin');
  return !sentFrom || sentFrom === origin;
}
