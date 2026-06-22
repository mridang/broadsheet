/**
 * @packageDocumentation
 *
 * Feed refresh orchestration: fetch each feed, parse it, enrich the newest
 * items with og:image / description / site-name from the article page, and
 * replace that feed's stored articles. Optionally upgrades source names via
 * names via Workers AI (the `AI` binding).
 */
import type { Database, Feed } from '../db';
import { allFeeds, writeEdition } from '../repository';
import { logInfo, logWarn } from '../util';
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
    const out = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages: [{ role: 'user', content: prompt }],
    });
    // Workers AI returns `response` as a string, or (for JSON output) an
    // already-parsed object.
    const resp = (out as { response?: unknown }).response;
    let parsed: { names?: Record<string, string> } | null = null;
    if (resp && typeof resp === 'object') {
      parsed = resp as { names?: Record<string, string> };
    } else if (typeof resp === 'string') {
      const match = resp.match(/\{[\s\S]*\}/);
      if (match)
        parsed = JSON.parse(match[0]) as { names?: Record<string, string> };
    }
    const names = parsed?.names ?? {};
    let applied = 0;
    items.forEach((it, i) => {
      const n = names[String(i)];
      if (n && n.trim()) {
        it.source = n.trim().slice(0, 60);
        applied++;
      }
    });
    logInfo({ event: 'ai.applied', applied, total: items.length });
  } catch (err) {
    logWarn({
      event: 'ai.failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The current edition date (YYYY-MM-DD, UTC). */
export const todayEdition = (): string => new Date().toISOString().slice(0, 10);

export async function refreshFeed(
  db: Database,
  env: CloudflareEnv,
  feed: Feed,
  edition: string = todayEdition(),
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
  await writeEdition(db, feed.id, edition, items);
  return { ok: true, n: items.length };
}

export async function refreshAll(
  db: Database,
  env: CloudflareEnv,
): Promise<{ feeds: number; ok: number; articles: number }> {
  const edition = todayEdition();
  const feeds = await allFeeds(db);
  const q = [...feeds];
  let ok = 0;
  let articles = 0;
  const worker = async (): Promise<void> => {
    for (let f = q.shift(); f; f = q.shift()) {
      const r = await refreshFeed(db, env, f, edition);
      if (r.ok) ok++;
      articles += r.n;
    }
  };
  await Promise.all(Array.from({ length: FEED_CONCURRENCY }, () => worker()));
  // History is kept indefinitely — no pruning of past editions.
  logInfo({
    event: 'scrape.completed',
    edition,
    feeds: feeds.length,
    ok,
    articles,
  });
  return { feeds: feeds.length, ok, articles };
}
