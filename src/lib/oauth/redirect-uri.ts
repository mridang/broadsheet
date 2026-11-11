/**
 * @packageDocumentation
 *
 * Which redirect URIs a client may register (RFC 8252, OAuth 2.1 §2.3): an
 * `https` address, an `http` address on the loopback interface (a desktop app
 * listening on a local port), or an app's own private-use scheme written in
 * reverse-domain form (`com.example.app:/callback`). No fragment, ever.
 */

/** The hosts an `http` redirect may name. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether `uri` is a redirect URI a client may register. */
export function isAcceptableRedirectUri(uri: string): boolean {
  if (uri.length > 2000 || !URL.canParse(uri)) return false;
  const url = new URL(uri);
  if (url.hash || uri.includes('#')) return false;
  if (url.protocol === 'https:') return url.hostname !== '';
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  // A private-use scheme must contain a dot so it names a domain the app owns.
  const scheme = url.protocol.slice(0, -1);
  return (
    /^[a-z][a-z0-9+.-]*$/i.test(scheme) &&
    scheme.includes('.') &&
    !scheme.endsWith('.')
  );
}

/**
 * Whether a redirect URI sent with a request matches one the client
 * registered. Exact match, except that a loopback address may use any port
 * (RFC 8252 §7.3: the app picks a free port when it runs).
 */
export function matchesRegistered(
  sent: string,
  registered: readonly string[],
): boolean {
  if (registered.includes(sent)) return true;
  if (!URL.canParse(sent)) return false;
  const given = new URL(sent);
  if (given.protocol !== 'http:' || !LOOPBACK.has(given.hostname)) {
    return false;
  }
  return registered.some((uri) => {
    if (!URL.canParse(uri)) return false;
    const known = new URL(uri);
    return (
      known.protocol === 'http:' &&
      known.hostname === given.hostname &&
      known.pathname === given.pathname &&
      known.search === given.search
    );
  });
}

/** `uri` with these query parameters added (undefined ones left out). */
export function redirectWith(
  uri: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
