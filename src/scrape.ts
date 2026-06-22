// Feed fetching + article scraping — port of scrape.mjs (fetch + regex, no deps),
// plus clean source-name resolution (og:site_name + domain_clean; optional LLM).
import { allFeeds, replaceArticles } from "./db";
import type { Env, Feed, ScrapedItem } from "./types";

const UA =
  "Mozilla/5.0 (compatible; HackerTimesBot/1.0; +https://broadsheet.apps.mrida.ng)";
const MAX_PER_FEED = 14;
const ENRICH = 10; // article pages fetched per feed for og:image + site name
const FEED_CONCURRENCY = 6;

async function get(url: string, ms = 15000): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*" },
      signal: c.signal,
      redirect: "follow",
    });
    return await r.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

const decode = (s = ""): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

const faviconFor = (u: string): string =>
  `https://www.google.com/s2/favicons?sz=64&domain=${hostOf(u)}`;

// ---- clean source names (handover §6 / A.6) ----
const OVERRIDES: Record<string, string> = {
  "news.ycombinator.com": "Hacker News",
  "github.com": "GitHub",
  "youtube.com": "YouTube",
  "twitter.com": "X",
  "x.com": "X",
};
const BLOG_PLATFORMS = new Set([
  "blogspot.com",
  "substack.com",
  "medium.com",
  "wordpress.com",
  "github.io",
  "pages.dev",
  "netlify.app",
  "vercel.app",
  "tumblr.com",
]);
const MULTI_TLD = new Set(["co", "ac", "org", "gov", "com", "net", "edu"]);
const STRIP_SUB = new Set(["www", "blog", "news", "m", "en", "docs", "about", "status"]);

const titleize = (s: string): string =>
  s
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 40);

export function domainClean(host: string): string {
  host = host.replace(/^www\./, "");
  if (OVERRIDES[host]) return OVERRIDES[host];
  const labels = host.split(".");
  const reg2 = labels.slice(-2).join(".");
  if (BLOG_PLATFORMS.has(reg2) && labels.length >= 3)
    return titleize(labels[labels.length - 3]);
  const l = [...labels];
  while (l.length > 2 && STRIP_SUB.has(l[0])) l.shift();
  const nameLabel =
    l.length >= 3 && MULTI_TLD.has(l[l.length - 2])
      ? l[l.length - 3]
      : l[l.length - 2];
  return titleize(nameLabel || host);
}

function ogImage(html: string, base: string): string {
  for (const p of ["og:image", "og:image:url", "twitter:image"]) {
    const m =
      html.match(
        new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i"),
      ) ||
      html.match(
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"),
      );
    if (m) {
      try {
        return new URL(m[1], base).href;
      } catch {
        return m[1];
      }
    }
  }
  return "";
}

function metaDesc(html: string): string {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return m ? decode(m[1]) : "";
}

function ogDesc(html: string): string {
  for (const p of ["og:description", "twitter:description"]) {
    const m =
      html.match(
        new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i"),
      ) ||
      html.match(
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"),
      );
    if (m) return decode(m[1]);
  }
  return "";
}

// hnrss feeds put HN metadata (not article text) in <description>; treat it as no summary.
const isBoilerplate = (s: string): boolean =>
  /Article URL:|Comments URL:|\bPoints:\s|#\s*Comments:/i.test(s);

function siteName(html: string): string {
  for (const p of ["og:site_name", "application-name"]) {
    const m =
      html.match(
        new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, "i"),
      ) ||
      html.match(
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"),
      );
    if (m) return decode(m[1]).slice(0, 40);
  }
  return "";
}

// Minimal RSS 2.0 + Atom parser
function parseFeed(xml: string, feedUrl: string): { title: string; items: ScrapedItem[] } {
  const title = tag(xml, "title") || hostOf(feedUrl);
  const items: ScrapedItem[] = [];
  const blocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ||
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ||
    [];
  for (const b of blocks) {
    let link = tag(b, "link");
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (m) link = m[1];
    }
    if (!link) continue;
    const pub =
      tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const date = pub ? new Date(pub) : null;
    let summary = (tag(b, "description") || tag(b, "summary") || tag(b, "content") || "").slice(0, 1200);
    if (isBoilerplate(summary)) summary = ""; // enrichment will fill it from the article page
    items.push({
      title: tag(b, "title") || link,
      url: link.trim(),
      summary,
      published_at: date && !isNaN(date.getTime()) ? date.toISOString() : "",
      source: domainClean(hostOf(link)),
      favicon: faviconFor(link),
      image: "",
    });
  }
  return { title, items: items.slice(0, MAX_PER_FEED) };
}

/** Optional: LLM-resolve canonical source names in one batched call. */
async function resolveNamesLLM(env: Env, items: ScrapedItem[]): Promise<void> {
  if (!env.ANTHROPIC_API_KEY || !items.length) return;
  const list = items.map((it, i) => `${i}\t${hostOf(it.url)}\t${it.title}`).join("\n");
  const prompt =
    "For each line `index<TAB>domain<TAB>title`, return the canonical publisher or " +
    "author name (e.g. cs.cornell.edu -> Cornell University, mnot.net -> Mark Nottingham). " +
    'Reply ONLY with JSON: {"names":{"<index>":"<name>"}}.\n\n' +
    list;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const j = (await r.json()) as { content?: { text?: string }[] };
    const text = j.content?.[0]?.text ?? "";
    const names = (JSON.parse(text) as { names?: Record<string, string> }).names ?? {};
    items.forEach((it, i) => {
      const n = names[String(i)];
      if (n && n.trim()) it.source = n.trim().slice(0, 60);
    });
  } catch {
    // deterministic names already populated — silently keep them.
  }
}

export async function refreshFeed(
  env: Env,
  feed: Feed,
): Promise<{ feed: string; ok: boolean; n: number }> {
  const xml = await get(feed.url);
  if (!xml) return { feed: feed.url, ok: false, n: 0 };
  const { title, items } = parseFeed(xml, feed.url);

  // enrich the newest few: og:image, fallback summary, and og:site_name
  await Promise.all(
    items.slice(0, ENRICH).map(async (it) => {
      const page = await get(it.url, 12000);
      if (!page) return;
      const img = ogImage(page, it.url);
      if (img) it.image = img;
      if (!it.summary || isBoilerplate(it.summary)) {
        const desc = ogDesc(page) || metaDesc(page);
        if (desc) it.summary = desc;
      }
      const name = siteName(page);
      if (name) it.source = name;
    }),
  );

  await resolveNamesLLM(env, items);
  await replaceArticles(env.DB, feed.id, items);
  return { feed: title || feed.url, ok: true, n: items.length };
}

export async function refreshAll(env: Env): Promise<void> {
  const feeds = await allFeeds(env.DB);
  const q = [...feeds];
  let ok = 0;
  let articles = 0;
  const worker = async () => {
    for (let f = q.shift(); f; f = q.shift()) {
      const r = await refreshFeed(env, f);
      if (r.ok) ok++;
      articles += r.n;
    }
  };
  await Promise.all(Array.from({ length: FEED_CONCURRENCY }, worker));
  console.log(
    `[scrape] refreshed ${ok}/${feeds.length} feeds, ${articles} articles @ ${new Date().toISOString()}`,
  );
}
