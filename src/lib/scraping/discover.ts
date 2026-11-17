const IS_FEED_PATTERN = /^\s*</u;
const IS_FEED_PATTERN_2 = /<html[\s>]/iu;
const IS_FEED_PATTERN_3 = /<rss[\s>]|<rdf:RDF[\s>]|<feed[\s>]/iu;
const IS_FEED_PATTERN_4 = /"version"\s*:\s*"https:\/\/jsonfeed\.org/iu;
const FEED_CANDIDATES_PATTERN = /<link\b[^>]*>/giu;
const FEED_CANDIDATES_PATTERN_2 = /\balternate\b/iu;
const FEED_CANDIDATES_PATTERN_3 = /<a\b[^>]*>/giu;
const FEED_CANDIDATES_PATTERN_4 = /rss|rdf|atom|feed|\.xml|json/iu;
const RETRY_AFTER_MINUTES_PATTERN = /^\s*\d+\s*$/u;
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
  /application\/(?:rss|atom|rdf)\+xml|application\/(?:feed\+)?json|text\/xml|application\/xml/iu;

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
  if (IS_FEED_PATTERN.test(head) && IS_FEED_PATTERN_2.test(head)) {
    return false;
  }
  return IS_FEED_PATTERN_3.test(head) || IS_FEED_PATTERN_4.test(head);
}

/**
 * How likely an address is to be the site's main feed: Atom over RSS over RDF,
 * comment and GeoRSS feeds last (NewsBlur's ranking).
 */
export function feedScore(url: string): number {
  const u = url.toLowerCase();
  const weights: readonly (readonly [string, number])[] = [
    ['atom', 6],
    ['rss', 5],
    ['rdf', 4],
    ['.xml', 3],
    ['feed', 2],
    ['json', 1],
    ['comments', -2],
    ['georss', -1],
  ];
  return weights.reduce(
    (score, [needle, weight]) => (u.includes(needle) ? score + weight : score),
    0,
  );
}

/** An attribute of one tag, or blank. */
function attribute(tag: string, name: string): string {
  return (
    new RegExp(String.raw`\b${name}\s*=\s*["']([^"']*)["']`, 'iu').exec(
      tag,
    )?.[1] ?? ''
  );
}

/** `href` resolved against the page, when it is an http(s) address. */
function resolve(href: string, base: string): string | undefined {
  try {
    const url = new URL(href.replaceAll('&amp;', '&'), base);
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
  const declared = [...html.matchAll(FEED_CANDIDATES_PATTERN)].flatMap(
    ([tag]) => {
      const url =
        FEED_CANDIDATES_PATTERN_2.test(attribute(tag, 'rel')) &&
        FEED_TYPES.test(attribute(tag, 'type'))
          ? resolve(attribute(tag, 'href'), pageUrl)
          : undefined;
      return url ? [url] : [];
    },
  );
  const host = new URL(pageUrl).host;
  const linked = [...html.matchAll(FEED_CANDIDATES_PATTERN_3)]
    .flatMap(([tag]) => {
      const url = resolve(attribute(tag, 'href'), pageUrl);
      return url &&
        new URL(url).host === host &&
        FEED_CANDIDATES_PATTERN_4.test(new URL(url).pathname)
        ? [url]
        : [];
    })
    .toSorted((a, b) => feedScore(b) - feedScore(a));
  const site = new URL('/', pageUrl).href;
  const usual = USUAL_PATHS.map((path) => new URL(path, site).href);
  return [...new Set([declared, linked, usual].flat())];
}

/**
 * The minutes a `Retry-After` header asks for (seconds, or an HTTP date), or
 * undefined when there is none or it cannot be read. Never negative.
 */
export function retryAfterMinutes(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = RETRY_AFTER_MINUTES_PATTERN.test(header)
    ? Number(header)
    : (Date.parse(header) - now) / 1000;
  return Number.isNaN(seconds)
    ? undefined
    : Math.max(0, Math.ceil(seconds / 60));
}
