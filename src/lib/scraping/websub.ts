/**
 * The pure parts of WebSub (PubSubHubbub): finding a feed's hub and self
 * links, and checking a push's `X-Hub-Signature`.
 */

/** Where a feed says its hub is, and the topic it is known by there. */
export interface WebSubLinks {
  readonly hub?: string;
  readonly self?: string;
}

/** The lease asked of a hub, in seconds: ten days, as NewsBlur asks. */
export const LEASE_SECONDS = 10 * 24 * 60 * 60;

/** The address of the `rel` link in an HTTP `Link` header. */
function headerLink(header: string | null, rel: string): string | undefined {
  for (const part of (header ?? '').split(/,(?=\s*<)/)) {
    const match = /^\s*<([^>]+)>(.*)$/.exec(part);
    const rels = /;\s*rel\s*=\s*"?([^";]+)"?/i.exec(match?.[2] ?? '')?.[1];
    if (match?.[1] && rels?.toLowerCase().split(/\s+/).includes(rel)) {
      return match[1];
    }
  }
  return undefined;
}

/** The address of the feed's own `<link rel>` (RSS `atom:link` or Atom). */
function feedLink(xml: string, rel: string): string | undefined {
  const head = xml.split(/<(?:item|entry)[\s>]/i, 1)[0] ?? '';
  for (const [tag] of head.matchAll(/<(?:atom:)?link\b[^>]*>/gi)) {
    const rels = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href && rels?.toLowerCase().split(/\s+/).includes(rel)) {
      return href.replaceAll('&amp;', '&');
    }
  }
  return undefined;
}

/** An absolute http(s) address, or undefined for anything else. */
function web(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The hub and self links of a feed, from its `Link` header first and its
 * header elements after (WebSub's discovery order). The self link falls back
 * to the address it was fetched from.
 */
export function webSubLinks(
  xml: string,
  linkHeader: string | null,
  feedUrl: string,
): WebSubLinks {
  const hub = web(
    headerLink(linkHeader, 'hub') ?? feedLink(xml, 'hub'),
    feedUrl,
  );
  if (!hub) return {};
  const self =
    web(headerLink(linkHeader, 'self') ?? feedLink(xml, 'self'), feedUrl) ??
    feedUrl;
  return { hub, self };
}

const ALGORITHMS: Readonly<Record<string, string>> = {
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
};

/**
 * Whether `signature` (`X-Hub-Signature: <method>=<hex>`) is the HMAC of
 * `body` under `secret`, with any of the methods WebSub allows.
 */
export async function signatureMatches(
  secret: string,
  body: Uint8Array<ArrayBuffer>,
  signature: string | null,
): Promise<boolean> {
  const match = /^(sha1|sha256|sha384|sha512)=([0-9a-f]+)$/i.exec(
    signature?.trim() ?? '',
  );
  const hash = match?.[1] && ALGORITHMS[match[1].toLowerCase()];
  if (!match?.[2] || !hash || match[2].length % 2) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash },
    false,
    ['verify'],
  );
  const given = Uint8Array.from(match[2].match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  return crypto.subtle.verify('HMAC', key, given, body);
}
