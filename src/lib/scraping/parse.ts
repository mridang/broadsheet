/**
 * @packageDocumentation
 *
 * Dependency-free feed + page parsing: RSS/Atom item extraction, HTML
 * meta scraping (og:image, descriptions, site name), and clean
 * source-name resolution. All regex + string work — no DOM, no deps.
 */
import type { ScrapedItem } from './types';

const MAX_PER_FEED = 14;

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
    if (isBoilerplate(summary)) summary = '';
    items.push({
      title: tag(b, 'title') || link,
      url: link.trim(),
      summary,
      published_at: date && !isNaN(date.getTime()) ? date.toISOString() : '',
      source: domainClean(hostOf(link)),
      favicon: faviconFor(link),
      image: '',
    });
  }
  return { title, items: items.slice(0, MAX_PER_FEED) };
}
