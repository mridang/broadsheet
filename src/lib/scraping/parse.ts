/**
 * @packageDocumentation
 *
 * Dependency-free feed + page parsing: RSS/Atom item extraction, HTML
 * meta scraping (og:image, descriptions, site name), and clean
 * source-name resolution. All regex + string work — no DOM, no deps.
 */
import type { ScrapedItem } from './types';

/** Most items kept from one fetch of a feed: enough for a full archive, not a runaway one. */
const MAX_PER_FEED = 100;

export const decode = (s = ''): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function tag(block: string, name: string): string {
  const m = block.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'),
  );
  return m?.[1] ? decode(m[1]) : '';
}

export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

const faviconFor = (u: string): string =>
  `https://www.google.com/s2/favicons?sz=64&domain=${hostOf(u)}`;

// ---- clean source names (handover §6 / A.6) ----
const OVERRIDES: Record<string, string> = {
  'news.ycombinator.com': 'Hacker News',
  'github.com': 'GitHub',
  'youtube.com': 'YouTube',
  'twitter.com': 'X',
  'x.com': 'X',
};
const BLOG_PLATFORMS = new Set([
  'blogspot.com',
  'substack.com',
  'medium.com',
  'wordpress.com',
  'github.io',
  'pages.dev',
  'netlify.app',
  'vercel.app',
  'tumblr.com',
]);
const MULTI_TLD = new Set(['co', 'ac', 'org', 'gov', 'com', 'net', 'edu']);
const STRIP_SUB = new Set([
  'www',
  'blog',
  'news',
  'm',
  'en',
  'docs',
  'about',
  'status',
]);

const titleize = (s: string): string =>
  s
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 40);

export function domainClean(host: string): string {
  const h = host.replace(/^www\./, '');
  const override = OVERRIDES[h];
  if (override) return override;
  const labels = h.split('.');
  const reg2 = labels.slice(-2).join('.');
  if (BLOG_PLATFORMS.has(reg2) && labels.length >= 3) {
    return titleize(labels[labels.length - 3] ?? h);
  }
  const l = [...labels];
  while (l.length > 2 && STRIP_SUB.has(l[0] ?? '')) l.shift();
  const penultimate = l[l.length - 2] ?? '';
  const nameLabel =
    l.length >= 3 && MULTI_TLD.has(penultimate) ? l[l.length - 3] : penultimate;
  return titleize(nameLabel || h);
}

function metaContent(html: string, prop: string): string {
  const m =
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        'i',
      ),
    ) ??
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
        'i',
      ),
    );
  return m?.[1] ?? '';
}

export function ogImage(html: string, base: string): string {
  for (const p of ['og:image', 'og:image:url', 'twitter:image']) {
    const v = metaContent(html, p);
    if (v) {
      try {
        return new URL(v, base).href;
      } catch {
        return v;
      }
    }
  }
  return '';
}

export function pageDescription(html: string): string {
  const og =
    metaContent(html, 'og:description') ||
    metaContent(html, 'twitter:description');
  if (og) return decode(og);
  const m = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  );
  return m?.[1] ? decode(m[1]) : '';
}

export function siteName(html: string): string {
  for (const p of ['og:site_name', 'application-name']) {
    const v = metaContent(html, p);
    if (v) return decode(v).slice(0, 40);
  }
  return '';
}

// hnrss feeds put HN metadata (not article text) in <description>.
export const isBoilerplate = (s: string): boolean =>
  /Article URL:|Comments URL:|\bPoints:\s|#\s*Comments:/i.test(s);

/** Pull the HN score out of an hnrss description ("... Points: 374 ..."). */
export function extractPoints(s: string): number {
  const m = s.match(/Points:\s*(\d+)/i);
  return m?.[1] ? Number(m[1]) : 0;
}

/** One element of a feed's header: its name, attributes, text and children. */
export interface FeedElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly FeedElement[];
}

/** Decode the five XML entities and numeric references in a text or attribute. */
function xmlText(raw: string): string {
  return raw
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
      const n = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Most header elements kept, so a hostile feed cannot grow without bound. */
const MAX_HEADER_ELEMENTS = 500;

/**
 * Every element of a feed's header, exactly as the feed gives it: the children
 * of the RSS or RDF `<channel>`, or of the Atom `<feed>`, except its items and
 * entries, each with all its attributes, its text (CDATA unwrapped, entities
 * decoded, whitespace collapsed) and its own children. Nothing is chosen or
 * renamed, so whatever a feed declares is kept. Empty when there is no feed.
 */
export function feedHeader(xml: string): FeedElement[] {
  interface Open {
    name: string;
    attributes: Record<string, string>;
    text: string;
    children: FeedElement[];
  }
  const source = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const root: Open = { name: '', attributes: {}, text: '', children: [] };
  const stack: Open[] = [root];
  let count = 0;
  const token =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of source.matchAll(token)) {
    const top = stack.at(-1)!;
    if (m[1] !== undefined || m[6] !== undefined) {
      top.text += m[1] ?? xmlText(m[6] ?? '');
      continue;
    }
    const name = m[3] ?? '';
    if (m[2]) {
      if (stack.length > 1 && top.name === name) {
        stack.pop();
        stack.at(-1)!.children.push({
          name: top.name,
          attributes: top.attributes,
          text: top.text.replace(/\s+/g, ' ').trim(),
          children: top.children,
        });
      }
      continue;
    }
    if (++count > MAX_HEADER_ELEMENTS * 50) break;
    const attributes: Record<string, string> = {};
    for (const a of (m[4] ?? '').matchAll(
      /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      attributes[a[1] ?? ''] = xmlText(a[2] ?? a[3] ?? '');
    }
    const open: Open = { name, attributes, text: '', children: [] };
    if (m[5]) {
      top.children.push({ ...open, children: [] });
    } else {
      stack.push(open);
    }
  }
  while (stack.length > 1) {
    const top = stack.pop()!;
    stack.at(-1)!.children.push({
      name: top.name,
      attributes: top.attributes,
      text: top.text.replace(/\s+/g, ' ').trim(),
      children: top.children,
    });
  }
  const document = root.children[0];
  const container =
    document?.name === 'feed'
      ? document
      : document?.children.find((c) => c.name === 'channel');
  return (container?.children ?? [])
    .filter((c) => c.name !== 'item' && c.name !== 'entry')
    .slice(0, MAX_HEADER_ELEMENTS);
}

/** The kinds of feed this parser reads. */
export type FeedFormat = 'rss' | 'atom' | 'rdf';

/** What a feed says about itself, from its header. Blank fields were not given. */
export interface FeedDetails {
  readonly format?: FeedFormat;
  readonly title: string;
  /** The site the feed belongs to. */
  readonly site_url: string;
  readonly description: string;
  readonly language: string;
  /** When the feed says it last changed, as RFC 3339. */
  readonly updated_at: string;
  /** How often the feed says it changes, in minutes. */
  readonly update_minutes?: number;
  /** The feed's own image (`<image><url>`, `<icon>` or `<logo>`), or blank. */
  readonly icon: string;
}

/** Minutes in one `sy:updatePeriod`. */
const PERIOD_MINUTES: Readonly<Record<string, number>> = {
  hourly: 60,
  daily: 1440,
  weekly: 10080,
  monthly: 43200,
  yearly: 525600,
};

/** An address made absolute against `base`, or blank when it is not one. */
function absolute(href: string, base: string): string {
  try {
    return href ? new URL(href.trim(), base).href : '';
  } catch {
    return '';
  }
}

/**
 * Read a feed's header: its format, title, site, description, language, when
 * it last changed, how often it says it changes (`sy:updatePeriod` and
 * `sy:updateFrequency`, else `ttl`) and its image (`<image><url>`, `<icon>` or
 * `<logo>`).
 */
export function feedDetails(xml: string, feedUrl: string): FeedDetails {
  const format: FeedFormat | undefined = /<rdf:RDF[\s>]/i.test(xml)
    ? 'rdf'
    : /<rss[\s>]/i.test(xml)
      ? 'rss'
      : /<feed[\s>]/i.test(xml)
        ? 'atom'
        : undefined;
  const head = xml.split(/<(?:item|entry)[\s>]/i)[0] ?? '';
  const withoutImage = head.replace(/<image[\s>][\s\S]*?<\/image>/gi, '');
  const alternate =
    head.match(
      /<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["']/i,
    )?.[1] ??
    head.match(/<link\b(?![^>]*\brel=)[^>]*\bhref=["']([^"']+)["']/i)?.[1] ??
    '';
  const site_url = absolute(tag(withoutImage, 'link') || alternate, feedUrl);
  const changed =
    tag(head, 'lastBuildDate') ||
    tag(withoutImage, 'pubDate') ||
    tag(withoutImage, 'updated') ||
    tag(withoutImage, 'dc:date');
  const date = changed ? new Date(changed) : null;
  const period = PERIOD_MINUTES[tag(head, 'sy:updatePeriod').toLowerCase()];
  const frequency = Number(tag(head, 'sy:updateFrequency') || 1);
  const ttl = Number(tag(head, 'ttl'));
  const update_minutes =
    period && frequency > 0
      ? Math.round(period / frequency)
      : ttl > 0
        ? ttl
        : undefined;
  const image =
    head.match(/<image[\s>][\s\S]*?<url>([\s\S]*?)<\/url>/i)?.[1] ??
    (tag(head, 'icon') || tag(head, 'logo'));
  return {
    ...(format ? { format } : {}),
    title: tag(withoutImage, 'title'),
    site_url,
    description: (
      tag(withoutImage, 'description') || tag(head, 'subtitle')
    ).slice(0, 500),
    language:
      tag(head, 'language') ||
      (head.match(/<feed\b[^>]*\bxml:lang=["']([^"']+)["']/i)?.[1] ?? ''),
    updated_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : '',
    ...(update_minutes ? { update_minutes } : {}),
    icon: absolute(decode(image), feedUrl),
  };
}

/** Longest author name and tag kept, and most tags kept per item. */
const MAX_AUTHOR = 120;
const MAX_TAG = 60;
const MAX_TAGS = 20;

/**
 * Who wrote an item: Atom's `<author><name>`, then `dc:creator`, then RSS
 * `<author>` (often `mail@x (Name)`, where the name in brackets is kept).
 */
export function itemAuthor(block: string): string {
  const atom = block.match(
    /<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i,
  );
  const raw = atom?.[1]
    ? decode(atom[1])
    : tag(block, 'dc:creator') || tag(block, 'author');
  const bracketed = raw.match(/^\S+@\S+\s*\((.+)\)$/);
  return (bracketed?.[1] ?? raw).trim().slice(0, MAX_AUTHOR);
}

/** An item's categories: RSS `<category>` text and Atom `term`s, deduplicated. */
export function itemTags(block: string): string[] {
  const found = [
    ...[...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((m) =>
      decode(m[1] ?? ''),
    ),
    ...[...block.matchAll(/<category[^>]*\bterm=["']([^"']+)["']/gi)].map((m) =>
      decode(m[1] ?? ''),
    ),
  ]
    .map((t) => t.slice(0, MAX_TAG))
    .filter(Boolean);
  return [...new Set(found)].slice(0, MAX_TAGS);
}

/** Minimal RSS 2.0 + Atom parser. */
export function parseFeed(
  xml: string,
  feedUrl: string,
): { title: string; items: ScrapedItem[] } {
  const title = tag(xml, 'title') || hostOf(feedUrl);
  const items: ScrapedItem[] = [];
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ??
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ??
    [];
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m?.[1]) link = m[1];
    }
    if (!link) continue;
    const pub =
      tag(b, 'pubDate') ||
      tag(b, 'published') ||
      tag(b, 'updated') ||
      tag(b, 'dc:date');
    const date = pub ? new Date(pub) : null;
    let summary = (
      tag(b, 'description') ||
      tag(b, 'summary') ||
      tag(b, 'content') ||
      ''
    ).slice(0, 1200);
    const points = extractPoints(summary);
    if (isBoilerplate(summary)) summary = '';
    const comments = tag(b, 'comments').trim();
    const guid = tag(b, 'guid') || tag(b, 'id');
    items.push({
      ...(comments ? { comments_url: comments } : {}),
      ...(guid ? { guid } : {}),
      title: tag(b, 'title') || link,
      url: link.trim(),
      summary,
      published_at: date && !isNaN(date.getTime()) ? date.toISOString() : '',
      source: domainClean(hostOf(link)),
      favicon: faviconFor(link),
      image: '',
      points,
      author: itemAuthor(b),
      tags: itemTags(b),
    });
  }
  return { title, items: items.slice(0, MAX_PER_FEED) };
}

/** Longest body text kept for one article, in characters. */
const MAX_BODY = 60_000;

/** Elements that never hold the story: code, chrome, navigation and forms. */
const NOT_STORY =
  /<(script|style|noscript|svg|template|nav|header|footer|aside|form|iframe|button)\b[\s\S]*?<\/\1>/gi;

/** Decode numeric character references (`&#8217;`, `&#x2019;`). */
const numericEntities = (s: string): string =>
  s.replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
    const n =
      code[0] === 'x' || code[0] === 'X'
        ? parseInt(code.slice(1), 16)
        : Number(code);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });

/** The permalink glyph many sites put at either end of a heading (`#`, `¶`, `§`). */
const PERMALINK = /^[#¶§]+\s*|\s*[#¶§]+$/g;

/** The inside of the first `<name>` element, or undefined when there is none. */
function region(html: string, name: string): string | undefined {
  return html.match(
    new RegExp(`<${name}\\b[^>]*>([\\s\\S]*)</${name}>`, 'i'),
  )?.[1];
}

/**
 * The readable text of an article page: its paragraphs, subheadings, list
 * items and quotes, from the `<article>` (else `<main>`, else `<body>`), as
 * plain text with a blank line between blocks. Navigation, scripts and other
 * page furniture are dropped. Empty when the page has no paragraphs.
 */
export function articleText(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(NOT_STORY, '');
  const body =
    region(clean, 'article') ??
    region(clean, 'main') ??
    region(clean, 'body') ??
    clean;
  const blocks: string[] = [];
  for (const m of body.matchAll(
    /<(p|h[2-4]|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi,
  )) {
    const heading = /^h/i.test(m[1] ?? '');
    const raw = decode(numericEntities(m[2] ?? ''));
    const text = heading ? raw.replace(PERMALINK, '').trim() : raw;
    if (heading ? text : text.split(' ').length >= 4) blocks.push(text);
  }
  return blocks.join('\n\n').slice(0, MAX_BODY);
}
