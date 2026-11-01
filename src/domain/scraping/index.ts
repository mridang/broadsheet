/**
 * @packageDocumentation
 *
 * Feed refresh orchestration: fetch each source once, however many people
 * follow it, parse it, enrich the newest
 * items with og:image / description / site-name from the article page, and
 * replace that feed's stored articles. Optionally upgrades source names via
 * names via Workers AI (the `AI` binding).
 */
import type { Database } from '@/domain/db/database';
import { Repository, type Source } from '@/domain/repository';
import { logInfo, logWarn } from '@/utils/logging';
import {
  articleText,
  domainClean,
  hostOf,
  ogImage,
  pageDescription,
  feedDetails,
  feedHeader,
  parseFeed,
  siteName,
} from '@/lib/scraping';
import type { ScrapedItem } from '@/lib/scraping';

export type { ScrapedItem } from '@/lib/scraping';

const UA =
  'Mozilla/5.0 (compatible; HackerTimesBot/1.0; +https://broadsheet.apps.mrida.ng)';
const ENRICH = 10; // article pages fetched per feed for og:image, site name and text

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

/**
 * Enrich the newest items in place: og:image, fallback summary, site name and
 * the article's readable text.
 */
async function enrich(items: ScrapedItem[]): Promise<void> {
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
      const text = articleText(page);
      if (text) it.body_text = text;
    }),
  );
}

/** The current edition date (YYYY-MM-DD, UTC). */
export const todayEdition = (): string => new Date().toISOString().slice(0, 10);

/** The address of a source to fetch and the id its articles are stored under. */
export type Fetchable = Pick<Source, 'id' | 'url'>;

/** Why a source's fetch failed, as recorded on the source. */
export const FETCH_FAILED = 'The feed could not be fetched.';

/**
 * Fetch one source and write today's edition of it, recording the success on
 * the source. Throws {@link FETCH_FAILED} when the feed cannot be fetched, so a
 * caller that retries can try again before recording the failure.
 */
export async function scrapeSource(
  db: Database,
  env: CloudflareEnv,
  source: Fetchable,
  edition: string = todayEdition(),
): Promise<number> {
  const repo = new Repository(db);
  const xml = await get(source.url);
  if (!xml) throw new Error(FETCH_FAILED);
  const { items } = parseFeed(xml, source.url);
  await repo.recordDetails(
    source.id,
    feedDetails(xml, source.url),
    feedHeader(xml),
  );
  await enrich(items);
  await resolveNames(env, items);
  await repo.writeEdition(source.id, edition, items);
  await repo.recordFetch(source.id);
  return items.length;
}

/**
 * Fetch one source once and write today's edition of it, noting on the source
 * whether the fetch worked.
 */
export async function refreshSource(
  db: Database,
  env: CloudflareEnv,
  source: Fetchable,
  edition: string = todayEdition(),
): Promise<{ ok: boolean; n: number }> {
  try {
    return { ok: true, n: await scrapeSource(db, env, source, edition) };
  } catch (error) {
    await new Repository(db).recordFetch(
      source.id,
      error instanceof Error ? error.message : FETCH_FAILED,
    );
    return { ok: false, n: 0 };
  }
}

// ---- historical backfill via the HN Algolia API (hnrss only serves today) ----
const HN_HOSTS = ['hnrss.org', 'news.ycombinator.com'];
const isHnFeed = (url: string): boolean =>
  HN_HOSTS.some((h) => url.includes(h));

interface AlgoliaHit {
  objectID: string;
  title?: string;
  url?: string | null;
  created_at?: string;
  points?: number;
}

/** Top HN stories for a single day (UTC), ranked by popularity, via Algolia. */
async function hnTopForDate(date: string): Promise<ScrapedItem[]> {
  const start = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  if (isNaN(start)) return [];
  const end = start + 86400;
  const url =
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=25` +
    `&numericFilters=created_at_i>=${start},created_at_i<${end}`;
  const txt = await get(url, 15000);
  if (!txt) return [];
  let hits: AlgoliaHit[] = [];
  try {
    hits = (JSON.parse(txt) as { hits?: AlgoliaHit[] }).hits ?? [];
  } catch {
    return [];
  }
  return hits
    .filter((h) => h.title)
    .map((h) => {
      const link =
        h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
      return {
        url: link,
        title: h.title ?? link,
        source: domainClean(hostOf(link)),
        favicon: `https://www.google.com/s2/favicons?sz=64&domain=${hostOf(link)}`,
        summary: '',
        image: '',
        published_at: h.created_at ?? `${date}T12:00:00Z`,
        points: h.points ?? 0,
      };
    });
}

/**
 * Fill in missing recent editions for the HN feeds from real historical HN
 * data (the last `days` days). Idempotent — days already stored are skipped.
 */
export async function backfillRecent(
  db: Database,
  env: CloudflareEnv,
  days = 7,
): Promise<{ filled: number }> {
  const repo = new Repository(db);
  const sources = (await repo.allSources()).filter((s) => isHnFeed(s.url));
  let filled = 0;
  for (const source of sources) {
    const have = new Set(await repo.editionsForSource(source.id));
    for (let i = 1; i <= days; i++) {
      const date = new Date(Date.now() - i * 86400000)
        .toISOString()
        .slice(0, 10);
      if (have.has(date)) continue;
      const items = await hnTopForDate(date);
      if (!items.length) continue;
      await enrich(items);
      await resolveNames(env, items);
      await repo.writeEdition(source.id, date, items);
      filled++;
      logInfo({
        event: 'backfill.day',
        source: source.id,
        date,
        n: items.length,
      });
    }
  }
  logInfo({ event: 'backfill.completed', filled });
  return { filled };
}
