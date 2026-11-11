/**
 * @packageDocumentation
 *
 * Dependency-free feed + page parsing: RSS/Atom item extraction, HTML
 * meta scraping (og:image, descriptions, site name), and clean
 * source-name resolution. All regex + string work — no DOM, no deps.
 */
import { decodeEntities } from '@/utils/html-entities';

import type { ScrapedItem } from './types';

/** Most items kept from one fetch of a feed: enough for a full archive, not a runaway one. */
const MAX_PER_FEED = 100;

export const decode = (s = ''): string =>
  stripTags(decodeEntities(s.replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))
    .replaceAll(/\s+/g, ' ')
    .trim();

function tag(block: string, name: string): string {
  const m = new RegExp(
    String.raw`<${name}[^>]*>([\s\S]*?)</${name}>`,
    'i',
  ).exec(block);
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
    .replaceAll(/[-_]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 40);

export function domainClean(host: string): string {
  const h = host.replace(/^www\./, '');
  const override = OVERRIDES[h];
  if (override) return override;
  const labels = h.split('.');
  const reg2 = labels.slice(-2).join('.');
  if (BLOG_PLATFORMS.has(reg2) && labels.length >= 3) {
    return titleize(labels.at(-3) ?? h);
  }
  const l = [...labels];
  while (l.length > 2 && STRIP_SUB.has(l[0] ?? '')) l.shift();
  const penultimate = l.at(-2) ?? '';
  const nameLabel =
    l.length >= 3 && MULTI_TLD.has(penultimate) ? l.at(-3) : penultimate;
  return titleize(nameLabel || h);
}

function metaContent(html: string, prop: string): string {
  const m =
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ).exec(html) ??
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      'i',
    ).exec(html);
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
  const m =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(
      html,
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
  const m = /Points:\s*(\d+)/i.exec(s);
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
    .replaceAll(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
      const n = /^x/i.test(code)
        ? Number.parseInt(code.slice(1), 16)
        : Number(code);

      return n > 0 && n <= 0x10_ff_ff ? String.fromCodePoint(n) : whole;
    })
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
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
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(/<\?[\s\S]*?\?>/g, '')
    .replaceAll(/<!DOCTYPE[^>]*>/gi, '');
  const root: Open = { name: '', attributes: {}, text: '', children: [] };
  const stack: Open[] = [root];
  let count = 0;
  const token =
    // eslint-disable-next-line sonarjs/regex-complexity -- one token pattern reads all feed markup; splitting it would change how malformed tags are read
    /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of source.matchAll(token)) {
    const top = stack.at(-1)!;
    const name = m[3] ?? '';
    if (m[1] !== undefined || m[6] !== undefined) {
      top.text += m[1] ?? xmlText(m[6] ?? '');
    } else if (m[2]) {
      if (stack.length > 1 && top.name === name) {
        stack.pop();
        stack.at(-1)!.children.push({
          name: top.name,
          attributes: top.attributes,
          text: top.text.replaceAll(/\s+/g, ' ').trim(),
          children: top.children,
        });
      }
    } else {
      count += 1;
      if (count > MAX_HEADER_ELEMENTS * 50) break;
      const attributes: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(
        // eslint-disable-next-line sonarjs/super-linear-regex -- the attribute text was already matched by the token pattern, so the scan stays short
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
  }
  while (stack.length > 1) {
    const top = stack.pop()!;
    stack.at(-1)!.children.push({
      name: top.name,
      attributes: top.attributes,
      text: top.text.replaceAll(/\s+/g, ' ').trim(),
      children: top.children,
    });
  }
  const [document] = root.children;
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
  weekly: 10_080,
  monthly: 43_200,
  yearly: 525_600,
};

/** An address made absolute against `base`, or blank when it is not one. */
function absolute(href: string, base: string): string {
  try {
    return href ? new URL(href.trim(), base).href : '';
  } catch {
    return '';
  }
}

/** The format a feed's markup declares, or undefined when it declares none. */
function feedFormatOf(xml: string): FeedFormat | undefined {
  if (/<rdf:RDF[\s>]/i.test(xml)) return 'rdf';
  if (/<rss[\s>]/i.test(xml)) return 'rss';
  if (/<feed[\s>]/i.test(xml)) return 'atom';
  return undefined;
}

/**
 * Read a feed's header: its format, title, site, description, language, when
 * it last changed, how often it says it changes (`sy:updatePeriod` and
 * `sy:updateFrequency`, else `ttl`) and its image (`<image><url>`, `<icon>` or
 * `<logo>`).
 */
export function feedDetails(xml: string, feedUrl: string): FeedDetails {
  const format = feedFormatOf(xml);
  const head = xml.split(/<(?:item|entry)[\s>]/i, 1)[0] ?? '';
  const withoutImage = head.replaceAll(/<image[\s>][\s\S]*?<\/image>/gi, '');
  const alternate =
    /<link\b(?=[^>]*\brel=["']alternate["'])[^>]*\bhref=["']([^"']+)["']/i.exec(
      head,
    )?.[1] ??
    /<link\b(?![^>]*\brel=)[^>]*\bhref=["']([^"']+)["']/i.exec(head)?.[1] ??
    '';
  const siteUrl = absolute(tag(withoutImage, 'link') || alternate, feedUrl);
  const changed =
    tag(head, 'lastBuildDate') ||
    tag(withoutImage, 'pubDate') ||
    tag(withoutImage, 'updated') ||
    tag(withoutImage, 'dc:date');
  const date = changed ? new Date(changed) : null;
  const period = PERIOD_MINUTES[tag(head, 'sy:updatePeriod').toLowerCase()];
  const frequency = Number(tag(head, 'sy:updateFrequency') || 1);
  const ttl = Number(tag(head, 'ttl'));
  const cadence =
    period && frequency > 0 ? Math.round(period / frequency) : undefined;
  const updateMinutes = cadence ?? (ttl > 0 ? ttl : undefined);
  const image =
    /<image[\s>][\s\S]*?<url>([\s\S]*?)<\/url>/i.exec(head)?.[1] ??
    (tag(head, 'icon') || tag(head, 'logo'));
  return {
    ...(format ? { format } : {}),
    title: tag(withoutImage, 'title'),
    site_url: siteUrl,
    description: (
      tag(withoutImage, 'description') || tag(head, 'subtitle')
    ).slice(0, 500),
    language:
      tag(head, 'language') ||
      (/<feed\b[^>]*\bxml:lang=["']([^"']+)["']/i.exec(head)?.[1] ?? ''),
    updated_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : '',
    ...(updateMinutes ? { update_minutes: updateMinutes } : {}),
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
  const atom = /<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i.exec(
    block,
  );
  const named = (raw: string): string =>
    // eslint-disable-next-line sonarjs/super-linear-regex -- one anchored match per author string; a linear rewrite would keep different bracketed names
    (/^\S+@\S+\s*\((.+)\)$/.exec(raw)?.[1] ?? raw).trim();
  const many = (name: string): string[] =>
    [
      ...block.matchAll(
        new RegExp(String.raw`<${name}[^>]*>([\s\S]*?)</${name}>`, 'gi'),
      ),
    ]
      .map((m) => named(decode(m[1] ?? '')))
      .filter(Boolean);
  const creators = many('dc:creator');
  const fallback = creators.length > 0 ? creators : many('author');
  const names = atom?.[1] ? [decode(atom[1])] : fallback;
  return [...new Set(names)].join(', ').slice(0, MAX_AUTHOR);
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

/** The attribute `name` of a tag's opening text, entity-decoded. */
function attr(opening: string, name: string): string {
  const m = new RegExp(
    String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  ).exec(opening);
  return xmlText(m?.[1] ?? m?.[2] ?? '').trim();
}

/** Whether a tag's `type`/`medium` says it is a picture, or says nothing. */
const isPicture = (opening: string): boolean => {
  const type = attr(opening, 'type').toLowerCase();
  const medium = attr(opening, 'medium').toLowerCase();
  return type ? type.startsWith('image/') : !medium || medium === 'image';
};

/**
 * An item's picture as NewsBlur finds it: an image `<enclosure>`, else
 * `<media:content>`, else `<media:thumbnail>`, else the first `<img>` of its
 * content. Made absolute against `base`; blank when there is none.
 */
export function itemImage(block: string, base: string): string {
  const urls = (name: string, pictures: boolean): string[] =>
    [...block.matchAll(new RegExp(String.raw`<${name}\b([^>]*)>`, 'gi'))]
      .map((m) => m[1] ?? '')
      .filter((o) => !pictures || isPicture(o))
      .map((o) => attr(o, 'url'));
  const content = `${block}${xmlText(block)}`.replaceAll(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    '$1',
  );
  const found = [
    ...urls('enclosure', true),
    ...urls('media:content', true),
    ...urls('media:thumbnail', false),
    ...[...content.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)].map(
      (m) => xmlText(m[1] ?? '').trim(),
    ),
  ];
  for (const href of found) {
    const url = absolute(href, base);
    if (/^https?:/i.test(url)) return url;
  }
  return '';
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
      const m = /<link[^>]*href=["']([^"']+)["']/i.exec(b);
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
      published_at:
        date && !Number.isNaN(date.getTime()) ? date.toISOString() : '',
      source: domainClean(hostOf(link)),
      favicon: faviconFor(link),
      image: itemImage(b, link.trim()),
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

/** The inside of the first `<name>` element, or undefined when there is none. */
function region(html: string, name: string): string | undefined {
  return new RegExp(String.raw`<${name}\b[^>]*>([\s\S]*)</${name}>`, 'i').exec(
    html,
  )?.[1];
}

/**
 * The readable text of an article page: its paragraphs, subheadings, list
 * items and quotes, from the `<article>` (else `<main>`, else `<body>`), as
 * plain text with a blank line between blocks. Navigation, scripts and other
 * page furniture are dropped. Empty when the page has no paragraphs.
 */
export function articleText(html: string): string {
  const clean = html
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll(NOT_STORY, '');
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
    const raw = decode(m[2] ?? '');
    const text = heading ? withoutPermalink(raw) : raw;
    if (heading ? text : text.split(' ').length >= 4) blocks.push(text);
  }
  return blocks.join('\n\n').slice(0, MAX_BODY);
}

/** Drops the permalink glyph many sites put at either end of a heading (`#`, `¶`, `§`), then trims it. */
function withoutPermalink(heading: string): string {
  const glyph = (c: string | undefined) => c !== undefined && '#¶§'.includes(c);
  let start = 0;
  let end = heading.length;
  while (glyph(heading[start])) start += 1;
  while (end > start && glyph(heading[end - 1])) end -= 1;
  return heading.slice(start, end).trim();
}

/** Removes every `<...>` run of one or more characters; same as `replaceAll(/<[^>]+>/g, '')`, in linear time. */
function stripTags(html: string): string {
  let out = '';
  let from = 0;
  let open = html.indexOf('<');
  while (open !== -1) {
    const close = html.indexOf('>', open + 1);
    if (close === -1) break;
    if (close === open + 1) {
      open = html.indexOf('<', close);
    } else {
      out += html.slice(from, open);
      from = close + 1;
      open = html.indexOf('<', from);
    }
  }
  return out + html.slice(from);
}
