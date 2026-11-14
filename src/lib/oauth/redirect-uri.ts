/**
 * @packageDocumentation
 *
 * Redirect URI rules. The authorization code is sent to the redirect URI, so
 * this is the check that stops a code going to an attacker: a client may only
 * use URIs it registered, compared exactly (loopback addresses excepted), and
 * the URIs themselves must be of a kind that can be trusted to reach the app
 * (see {@link isAcceptableRedirectUri}).
 */

import { parseUrl } from '@/utils/url';

/** Schemes that can run script or read files; never a valid redirect target, dotted or not. */
const FORBIDDEN_SCHEMES: ReadonlySet<string> = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'blob:',
  'about:',
  'ftp:',
]);

/** Hosts that mean "this machine", where native apps pick a free port. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

/**
 * Well-known desktop assistants whose private-use schemes are one short word
 * rather than a reverse domain name (RFC 8252 §7.1 asks for the latter, but
 * these clients shipped before the MCP authorization spec and still use the
 * short form). Without this list Cursor (`cursor://anysphere.cursor-retrieval/…`),
 * VS Code (`vscode://…`) and Claude Desktop (`claude://…`) could not connect.
 * Add a scheme here only for a real client that cannot use a dotted one.
 */
const KNOWN_APP_SCHEMES: ReadonlySet<string> = new Set([
  'claude:',
  'cursor:',
  'vscode:',
  'vscode-insiders:',
  'vscodium:',
  'windsurf:',
  'zed:',
]);

/**
 * How a redirect address reaches the client: over the web, to this computer
 * (`loopback`), to a machine on a private network (`private`), or to an
 * installed app.
 */
export type RedirectKind = 'web' | 'loopback' | 'private' | 'app';

/** Name endings that only resolve inside a private network (mDNS, split-horizon DNS, home routers). */
const PRIVATE_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.localdomain',
  '.intranet',
] as const;

/** The four numbers of a dotted IPv4 address, or undefined if the host is not one. */
function ipv4Octets(host: string): readonly number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return match ? match.slice(1).map(Number) : undefined;
}

/** The IPv4 address an IPv4-mapped IPv6 host (`[::ffff:7f00:1]`, as `URL` writes it) stands for, as a dotted string. */
function mappedIpv4(host: string): string | undefined {
  const match = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host);
  if (!match) {
    return undefined;
  }
  const [high = 0, low = 0] = match.slice(1).map((g) => Number.parseInt(g, 16));
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/**
 * Whether a host (as `URL.hostname` writes it: lower case, IPv4 in dotted form,
 * IPv6 in brackets) is this very computer: `localhost` and its subdomains, the
 * whole `127.0.0.0/8` block, `0.0.0.0` and `[::1]`.
 */
export function isLoopbackHost(host: string): boolean {
  const ipv4 = ipv4Octets(mappedIpv4(host) ?? host);
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  return (
    ['[::1]', '[::]'].includes(host) ||
    (ipv4 !== undefined && (ipv4[0] === 127 || ipv4.every((n) => n === 0)))
  );
}

/**
 * Whether a host is on a private network rather than the public internet: the
 * RFC 1918 blocks, link-local and carrier-grade-NAT addresses, IPv6 unique-local
 * and link-local addresses, names that only resolve inside a network (`.local`
 * and friends), and single-word names such as `nas`.
 */
export function isPrivateHost(host: string): boolean {
  const ipv4 = ipv4Octets(mappedIpv4(host) ?? host);
  if (ipv4) {
    const [a = 0, b = 0] = ipv4;
    return [
      a === 10,
      a === 172 && b >= 16 && b <= 31,
      a === 192 && b === 168,
      a === 169 && b === 254,
      a === 100 && b >= 64 && b <= 127,
    ].some(Boolean);
  }
  if (host.startsWith('[')) {
    return /^\[(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host);
  }
  return (
    !host.includes('.') ||
    PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

/** Whether a URL is plain http to this machine. */
function isLoopbackHttp(url: Readonly<URL>): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Whether a private-use scheme is acceptable: a reverse-domain name (it contains
 * a dot, as RFC 8252 §7.1 recommends, e.g. `com.example.app:`) or one of the
 * {@link KNOWN_APP_SCHEMES}. Anything on the forbidden list is refused first.
 */
function isAcceptableAppScheme(protocol: string): boolean {
  return (
    !FORBIDDEN_SCHEMES.has(protocol) &&
    (KNOWN_APP_SCHEMES.has(protocol) || protocol.slice(0, -1).includes('.'))
  );
}

/**
 * Whether a client may register this redirect URI. The MCP authorization spec
 * says redirect URIs MUST be `localhost` or HTTPS, and RFC 8252 lets native apps
 * use private-use schemes, so the rule is:
 *
 *  - `https:` anywhere;
 *  - `http:` only to a loopback host (`localhost`, `127.0.0.1`, `[::1]`), any port;
 *  - a private-use scheme only if it is a reverse domain name (contains a dot)
 *    or one of a few known assistants' own schemes (see {@link KNOWN_APP_SCHEMES});
 *  - nothing else (`http:` to a real host, `ws:`, `mailto:`, `javascript:`, …).
 *
 * Fragments, embedded credentials and anything but printable ASCII (spaces and
 * look-alike or direction-changing characters included) are never allowed.
 */
export function isAcceptableRedirectUri(uri: string): boolean {
  // Printable ASCII only. RFC 3986 requires anything else to be percent-encoded,
  // and a raw look-alike letter or direction-changing character would make the
  // address we show differ from the one a person reads.
  if (!/^[\u0021-\u007E]+$/.test(uri)) {
    return false;
  }
  const url = parseUrl(uri);
  if (!url || url.hash || url.username || url.password) {
    return false;
  }
  if (url.protocol === 'https:') {
    return url.hostname !== '';
  }
  if (url.protocol === 'http:') {
    return isLoopbackHttp(url);
  }
  return isAcceptableAppScheme(url.protocol);
}

/**
 * How a redirect address reaches the client, for the approval screen:
 * `loopback` means a web server on the user's own computer (whatever the
 * scheme: `https://localhost` is as local as `http://127.0.0.1`), `private`
 * means a machine on a private network, `app` means an installed app's own
 * scheme, `web` is everything else.
 */
export function redirectKind(uri: string): RedirectKind {
  const url = parseUrl(uri);
  if (!url) {
    return 'web';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'app';
  }
  if (isLoopbackHost(url.hostname)) {
    return 'loopback';
  }
  return isPrivateHost(url.hostname) ? 'private' : 'web';
}

/**
 * Whether the redirect URI in a request is one the client registered. Exact
 * match, except that for a loopback `http` URI the port may differ, because a
 * native app can't know its port in advance (RFC 8252 §7.3).
 */
export function redirectUriMatches(
  requested: string,
  registered: readonly string[],
): boolean {
  if (registered.includes(requested)) {
    return true;
  }
  const want = parseUrl(requested);
  if (
    !want ||
    want.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(want.hostname)
  ) {
    return false;
  }
  return registered.some((r) => {
    const have = parseUrl(r);
    if (have === undefined) {
      return false;
    }
    return (
      have.protocol === 'http:' &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}
