/**
 * @packageDocumentation
 *
 * Finding a feed from the address of a page, as NewsBlur's feed finder does:
 * the feeds a page declares in `<link rel="alternate">`, then links that look
 * like feeds, then the addresses feeds usually live at. Pure string work; the
 * caller fetches the candidates and keeps the first that is a feed.
 */

/** The `<link>` types that announce a feed. */
const FEED_TYPES =
  /application\/(?:rss|atom|rdf)\+xml|application\/(?:feed\+)?json|text\/xml|application\/xml/i;

/** Where feeds usually live when a page declares none. */
const USUAL_PATHS = [
  'feed',
  'rss',
  'atom.xml',
  'index.atom',
  'index.rdf',
  'rss.xml',
  'index.xml',
  'index.rss',
  'feed.xml',
];

/** Whether a fetched body is a feed (RSS, Atom, RDF or JSON Feed), not a page. */
export function isFeed(body: string): boolean {
  const head = body.slice(0, 2000);
  if (/^\s*</.test(head) && /<html[\s>]/i.test(head)) return false;
  return (
    /<rss[\s>]|<rdf:RDF[\s>]|<feed[\s>]/i.test(head) ||
    /"version"\s*:\s*"https:\/\/jsonfeed\.org/i.test(head)
  );
}

/**
 * How likely an address is to be the site's main feed: Atom over RSS over RDF,
 * comment and GeoRSS feeds last (NewsBlur's ranking).
 */
export function feedScore(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (u.includes('atom')) score += 6;
  if (u.includes('rss')) score += 5;
  if (u.includes('rdf')) score += 4;
  if (u.includes('.xml')) score += 3;
  if (u.includes('feed')) score += 2;
  if (u.includes('json')) score += 1;
  if (u.includes('comments')) score -= 2;
  if (u.includes('georss')) score -= 1;
  return score;
}

/** An attribute of one tag, or blank. */
function attr(tag: string, name: string): string {
  return (
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] ?? ''
  );
}

/** `href` resolved against the page, when it is an http(s) address. */
function resolve(href: string, base: string): string | undefined {
  try {
    const url = new URL(href.replace(/&amp;/g, '&'), base);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The addresses to try for a page's feed, best first: those it declares, then
 * same-site links that look like feeds (ranked by {@link feedScore}), then the
 * usual paths on its site. No address appears twice.
 */
export function feedCandidates(html: string, pageUrl: string): string[] {
  const declared: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (
      /\balternate\b/i.test(attr(tag, 'rel')) &&
      FEED_TYPES.test(attr(tag, 'type'))
    ) {
      const url = resolve(attr(tag, 'href'), pageUrl);
      if (url) declared.push(url);
    }
  }
  const host = new URL(pageUrl).host;
  const linked: string[] = [];
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const url = resolve(attr(tag, 'href'), pageUrl);
    if (
      url &&
      new URL(url).host === host &&
      /rss|rdf|atom|feed|\.xml|json/i.test(new URL(url).pathname)
    ) {
      linked.push(url);
    }
  }
  linked.sort((a, b) => feedScore(b) - feedScore(a));
  const site = new URL('/', pageUrl).href;
  const usual = USUAL_PATHS.map((path) => new URL(path, site).href);
  return [...new Set([...declared, ...linked, ...usual])];
}

/**
 * The minutes a `Retry-After` header asks for (seconds, or an HTTP date), or
 * undefined when there is none or it cannot be read. Never negative.
 */
export function retryAfterMinutes(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = /^\s*\d+\s*$/.test(header)
    ? Number(header)
    : (Date.parse(header) - now) / 1000;
  return Number.isNaN(seconds)
    ? undefined
    : Math.max(0, Math.ceil(seconds / 60));
}
