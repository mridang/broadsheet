/**
 * @packageDocumentation
 *
 * Feed refresh orchestration: fetch each feed, parse it, enrich the newest
 * items with og:image / description / site-name from the article page, and
 * replace that feed's stored articles. Optionally upgrades source names via
 * names via Workers AI (the `AI` binding).
 */
import type { Database, Feed } from '../db';
import { allFeeds, replaceArticles } from '../repository';
import { logInfo } from '../util';
import { hostOf, ogImage, pageDescription, parseFeed, siteName } from './parse';
import type { ScrapedItem } from './types';

export type { ScrapedItem } from './types';

const UA =
  'Mozilla/5.0 (compatible; HackerTimesBot/1.0; +https://broadsheet.apps.mrida.ng)';
const ENRICH = 10; // article pages fetched per feed for og:image + site name
const FEED_CONCURRENCY = 6;

async function get(url: string, ms = 15000): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: c.signal,
      redirect: 'follow',
    });
    return await r.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

/** Optional: LLM-resolve canonical source names in one batched call. */
async function resolveNames(
  env: CloudflareEnv,
  items: ScrapedItem[],
): Promise<void> {
  if (!env.AI || !items.length) return;
  const list = items
    .map((it, i) => `${i}\t${hostOf(it.url)}\t${it.title}`)
    .join('\n');
  const prompt =
    'For each line `index<TAB>domain<TAB>title`, return the canonical publisher or ' +
    'author name (e.g. cs.cornell.edu -> Cornell University, mnot.net -> Mark Nottingham). ' +
    'Reply ONLY with JSON: {"names":{"<index>":"<name>"}}.\n\n' +
    list;
  try {
    const out = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
    });
    const text =
      typeof out === 'object' && out !== null && 'response' in out
        ? String((out as { response?: unknown }).response ?? '')
        : '';
    // The model may wrap the JSON in prose — pull out the object.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return;
    const names =
      (JSON.parse(match[0]) as { names?: Record<string, string> }).names ?? {};
    items.forEach((it, i) => {
      const n = names[String(i)];
      if (n && n.trim()) it.source = n.trim().slice(0, 60);
    });
  } catch {
    // deterministic names already populated — silently keep them.
  }
}

export async function refreshFeed(
  db: Database,
  env: CloudflareEnv,
  feed: Feed,
): Promise<{ ok: boolean; n: number }> {
  const xml = await get(feed.url);
  if (!xml) return { ok: false, n: 0 };
  const { items } = parseFeed(xml, feed.url);

  await Promise.all(
    items.slice(0, ENRICH).map(async (it) => {
      const page = await get(it.url, 12000);
      if (!page) return;
      const img = ogImage(page, it.url);
      if (img) it.image = img;
      if (!it.summary) {
        const desc = pageDescription(page);
        if (desc) it.summary = desc;
      }
      const name = siteName(page);
      if (name) it.source = name;
    }),
  );

  await resolveNames(env, items);
  await replaceArticles(db, feed.id, items);
  return { ok: true, n: items.length };
}

export async function refreshAll(
  db: Database,
  env: CloudflareEnv,
): Promise<{ feeds: number; ok: number; articles: number }> {
  const feeds = await allFeeds(db);
  const q = [...feeds];
  let ok = 0;
  let articles = 0;
  const worker = async (): Promise<void> => {
    for (let f = q.shift(); f; f = q.shift()) {
      const r = await refreshFeed(db, env, f);
      if (r.ok) ok++;
      articles += r.n;
    }
  };
  await Promise.all(Array.from({ length: FEED_CONCURRENCY }, () => worker()));
  logInfo({ event: 'scrape.completed', feeds: feeds.length, ok, articles });
  return { feeds: feeds.length, ok, articles };
}
