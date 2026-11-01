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
import { errorMessage, logInfo, logWarn } from '@/utils/logging';
import {
  articleText,
  distinctStories,
  domainClean,
  feedCandidates,
  fetchIntervalMinutes,
  isFeed,
  NOTIFIED_INTERVAL_MINUTES,
  signatureMatches,
  webSubLinks,
  maxAgeMinutes,
  retryAfterMinutes,
  withJitter,
  hostOf,
  ogImage,
  pageDescription,
  feedDetails,
  feedHeader,
  parseFeed,
  siteName,
} from '@/lib/scraping';
import type { FeedDetails, ScrapedItem, WebSubLinks } from '@/lib/scraping';
import {
  firstWorkingIcon,
  iconCandidates,
  manifestIcons,
  manifestUrl,
  pageIcons,
  type IconFetcher,
} from '@/domain/scraping/icons';
import { needsSubscription, subscribeToHub } from '@/domain/websub';

export type { ScrapedItem } from '@/lib/scraping';

const UA =
  'Mozilla/5.0 (compatible; HackerTimesBot/1.0; +https://broadsheet.apps.mrida.ng)';
/** Sent once more after an error answer, as NewsBlur retries with a browser's agent. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
/** How often a conditional fetch is sent without its validators, to catch servers that never change them. */
const UNCONDITIONAL_SHARE = 0.01;
const ENRICH = 10; // article pages fetched per feed for og:image, site name and text
const MAX_REDIRECTS = 5;
const DISCOVERY_PROBES = 6; // candidate addresses tried when finding a page's feed
/** Shorter text than this is a failed extraction, not an article (NewsBlur's cut). */
export const MIN_TEXT = 100;

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

/** Fetch an icon candidate, following redirects, giving up after a few seconds. */
const fetchIcon: IconFetcher = (url) =>
  fetch(url, {
    headers: { 'user-agent': UA, accept: 'image/*,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });

/**
 * The icon the feed's site really uses: every icon its home page and manifest
 * declare, then the feed's own image, then `/favicon.ico`; the first that
 * loads as an image, or blank when none does.
 */
async function siteIcon(
  details: FeedDetails,
  feedUrl: string,
): Promise<string> {
  const site = details.site_url || new URL(feedUrl).origin + '/';
  const page = await get(site, 10000);
  const manifest = manifestUrl(page, site);
  const candidates = iconCandidates({
    page: pageIcons(page, site),
    manifest: manifest
      ? manifestIcons(await get(manifest, 8000), manifest)
      : [],
    feed: details.icon,
    site,
  });
  return firstWorkingIcon(candidates, fetchIcon);
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
      if (text.length >= MIN_TEXT) it.body_text = text;
    }),
  );
}

/** The current edition date (YYYY-MM-DD, UTC). */
export const todayEdition = (): string => new Date().toISOString().slice(0, 10);

/**
 * The address of a source to fetch, the id its articles are stored under, and
 * what a conditional GET needs: the validators of its last answer and when it
 * was last fetched.
 */
export type Fetchable = Pick<Source, 'id' | 'url'> &
  Partial<Pick<Source, 'etag' | 'last_modified' | 'last_fetched_at'>>;

/** Why a source's fetch failed, as recorded on the source. */
export const FETCH_FAILED = 'The feed could not be fetched.';

/** What fetching a feed's address answered. */
export interface FeedAnswer {
  readonly status: number;
  readonly body: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  /** Minutes a 429 or 503 asked to be left alone for. */
  readonly retryAfter?: number;
  /** Where the feed now lives, when every redirect on the way was permanent. */
  readonly movedTo?: string;
  /** Minutes a 200's `Cache-Control: max-age` asks to keep it. */
  readonly maxAge?: number;
  /** The answer's `Link` header, where a WebSub hub may be named. */
  readonly link?: string | null;
}

/**
 * Fetch a feed's address, conditionally when validators are given, following
 * up to {@link MAX_REDIRECTS} redirects by hand so a move for good (301 or
 * 308 all the way) can be told from a temporary one. Throws when the address
 * cannot be reached at all.
 */
export async function fetchFeed(
  url: string,
  validators: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FeedAnswer> {
  const first = await fetchOnce(url, validators, UA);
  // A 4xx or 5xx is often a bot block: ask once more as a browser would.
  return first.status >= 400 && first.status !== 429
    ? fetchOnce(url, validators, BROWSER_UA)
    : first;
}

/** One {@link fetchFeed} attempt with the given user agent. */
async function fetchOnce(
  url: string,
  validators: { etag?: string | null; lastModified?: string | null },
  agent: string,
): Promise<FeedAnswer> {
  const headers: Record<string, string> = {
    'user-agent': agent,
    accept:
      'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8',
  };
  if (validators.etag) headers['if-none-match'] = validators.etag;
  if (validators.lastModified)
    headers['if-modified-since'] = validators.lastModified;
  let at = url;
  let permanent = true;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await fetch(at, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const location = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && r.status !== 304 && location) {
      permanent &&= r.status === 301 || r.status === 308;
      at = new URL(location, at).href;
      continue;
    }
    return {
      status: r.status,
      body: r.status === 200 ? await r.text() : '',
      etag: r.headers.get('etag'),
      lastModified: r.headers.get('last-modified'),
      retryAfter:
        r.status === 429 || r.status === 503
          ? retryAfterMinutes(r.headers.get('retry-after'))
          : undefined,
      movedTo: permanent && at !== url ? at : undefined,
      maxAge:
        r.status === 200
          ? maxAgeMinutes(r.headers.get('cache-control'))
          : undefined,
      link: r.headers.get('link'),
    };
  }
  throw new Error('The feed redirects too many times.');
}

/** How one source's fetch went. */
export interface ScrapeResult {
  /** Stories written; 0 when the feed had not changed or the fetch failed. */
  readonly articles: number;
  /** Why the fetch failed for good, already recorded on the source. */
  readonly failed?: string;
}

/**
 * Fetch one source and write today's edition of it, recording on the source
 * how it went. When today's edition was already written, the fetch is
 * conditional and a 304 leaves it as it is. A feed that moved for good is
 * followed to its new address. An answer that will not change on a retry (a
 * 4xx, a 429 or 503 that says when to come back, a page that is not a feed) is
 * recorded and returned as `failed`; a network failure or other 5xx throws, so
 * a caller that retries can try again before recording it.
 */
export async function scrapeSource(
  db: Database,
  env: CloudflareEnv,
  source: Fetchable,
  edition: string = todayEdition(),
  random: () => number = Math.random,
  rediscover = true,
): Promise<ScrapeResult> {
  const repo = new Repository(db);
  const started = Date.now();
  const took = () => ({ durationMs: Date.now() - started });
  const conditional =
    source.last_fetched_at?.slice(0, 10) === edition &&
    random() >= UNCONDITIONAL_SHARE;
  let answer: FeedAnswer;
  try {
    answer = await fetchFeed(
      source.url,
      conditional
        ? { etag: source.etag, lastModified: source.last_modified }
        : {},
    );
  } catch {
    throw new Error(FETCH_FAILED);
  }
  const id = answer.movedTo
    ? await repo.moveSource(source.id, answer.movedTo)
    : source.id;
  const nextFetch = () => nextFetchMinutes(repo, id, random);
  if (answer.status === 304) {
    await repo.recordFetch(id, { nextFetch: await nextFetch(), ...took() });
    return { articles: 0 };
  }
  if (answer.status !== 200) {
    const error = `The feed answered HTTP ${answer.status}.`;
    if (answer.status >= 500 && answer.retryAfter === undefined) {
      throw new Error(error);
    }
    // A feed never fetched may have moved: look for it from its site again.
    if (rediscover && answer.status !== 429 && !source.last_fetched_at) {
      const found = await discoverFeed(new URL('/', source.url).href, false);
      if (found && found !== source.url) {
        const moved = await repo.moveSource(id, found);
        return scrapeSource(
          db,
          env,
          { id: moved, url: found },
          edition,
          random,
          false,
        );
      }
    }
    await repo.recordFetch(id, {
      error,
      retryAfter: answer.retryAfter,
      ...took(),
    });
    return { articles: 0, failed: error };
  }
  const xml = answer.body;
  if (!isFeed(xml)) {
    const error = 'The address is not a feed.';
    await repo.recordFetch(id, { error, ...took() });
    return { articles: 0, failed: error };
  }
  const url = answer.movedTo ?? source.url;
  const articles = await ingest(db, env, id, url, xml, edition);
  await keepPushing(db, id, webSubLinks(xml, answer.link ?? null, url));
  await repo.recordFetch(id, {
    etag: answer.etag?.slice(0, 255) ?? null,
    lastModified: answer.lastModified,
    ...took(),
    nextFetch: await nextFetchMinutes(repo, id, random, answer.maxAge),
  });
  return { articles };
}

/**
 * Minutes until a source is fetched again: what its `max-age` asked, else its
 * schedule with jitter, and never more than {@link NOTIFIED_INTERVAL_MINUTES}
 * while anyone is notified of its stories.
 */
async function nextFetchMinutes(
  repo: Repository,
  id: number,
  random: () => number,
  maxAge?: number,
): Promise<number> {
  const activity = await repo.sourceActivity(id);
  const minutes =
    maxAge ?? withJitter(fetchIntervalMinutes(activity), random());
  return activity.notified
    ? Math.min(minutes, NOTIFIED_INTERVAL_MINUTES)
    : minutes;
}

/**
 * Write a feed's stories to the source's edition, with its details and icon:
 * what a fetch and a push both do with a feed's body. The stories written.
 */
async function ingest(
  db: Database,
  env: CloudflareEnv,
  id: number,
  url: string,
  xml: string,
  edition: string,
  prune = true,
): Promise<number> {
  const repo = new Repository(db);
  const items = distinctStories(parseFeed(xml, url).items);
  const details = feedDetails(xml, url);
  await repo.recordDetails(
    id,
    { ...details, icon: await siteIcon(details, url) },
    feedHeader(xml),
  );
  await enrich(items);
  await resolveNames(env, items);
  await repo.writeEdition(id, edition, items, prune);
  return items.length;
}

/**
 * Subscribe a source at the WebSub hub its feed names when it is not yet, or
 * renew the lease before it runs out. A hub that cannot be reached leaves the
 * source to its schedule.
 */
async function keepPushing(
  db: Database,
  id: number,
  links: WebSubLinks,
): Promise<void> {
  const source = await new Repository(db).sourceById(id);
  if (!source || !links.hub || !links.self) return;
  if (!needsSubscription(source, links)) return;
  try {
    const accepted = await subscribeToHub(db, id, {
      hub: links.hub,
      self: links.self,
    });
    logInfo({ event: 'websub.subscribed', source: id, accepted });
  } catch (error) {
    logWarn({
      event: 'websub.failed',
      source: id,
      error: errorMessage(error),
    });
  }
}

/** How a hub's push was taken. */
export type PushResult = 'unknown' | 'unsigned' | 'accepted';

/**
 * Take content a WebSub hub pushed for a source as a fresh fetch of it: when
 * the source has a subscription and the body's signature matches its secret,
 * its stories are added to today's edition (nothing already there is dropped,
 * since a push may carry only the new ones) and the fetch is recorded, which
 * reschedules it. `unknown` when the source has no subscription, `unsigned`
 * when the signature does not match (the push is ignored, as WebSub asks).
 */
export async function acceptPush(
  db: Database,
  env: CloudflareEnv,
  sourceId: number,
  body: Uint8Array<ArrayBuffer>,
  signature: string | null,
  edition: string = todayEdition(),
  random: () => number = Math.random,
): Promise<PushResult> {
  const repo = new Repository(db);
  const source = await repo.sourceById(sourceId);
  if (!source?.websub_secret) return 'unknown';
  if (!(await signatureMatches(source.websub_secret, body, signature))) {
    return 'unsigned';
  }
  const started = Date.now();
  const xml = new TextDecoder().decode(body);
  if (!isFeed(xml)) return 'accepted';
  await ingest(db, env, sourceId, source.url, xml, edition, false);
  await repo.recordFetch(sourceId, {
    durationMs: Date.now() - started,
    nextFetch: await nextFetchMinutes(repo, sourceId, random),
  });
  return 'accepted';
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
  const started = Date.now();
  try {
    const result = await scrapeSource(db, env, source, edition);
    return { ok: !result.failed, n: result.articles };
  } catch (error) {
    await new Repository(db).recordFetch(source.id, {
      error: error instanceof Error ? error.message : FETCH_FAILED,
      durationMs: Date.now() - started,
    });
    return { ok: false, n: 0 };
  }
}

/**
 * The feed address for what a person typed: the address itself when it is a
 * feed, else the best feed its page declares or links to, else a feed at one
 * of the usual paths (at most {@link DISCOVERY_PROBES} addresses are tried).
 * The address as given when it cannot be fetched (its first fetch will record
 * why), unless `keepUnreachable` is off; undefined when it is a page with no
 * feed to be found.
 */
export async function discoverFeed(
  url: string,
  keepUnreachable = true,
): Promise<string | undefined> {
  let page: FeedAnswer;
  try {
    page = await fetchFeed(url);
  } catch {
    return keepUnreachable ? url : undefined;
  }
  const here = page.movedTo ?? url;
  if (page.status === 200 && isFeed(page.body)) return here;
  if (page.status !== 200) return keepUnreachable ? here : undefined;
  for (const candidate of feedCandidates(page.body, here).slice(
    0,
    DISCOVERY_PROBES,
  )) {
    try {
      const answer = await fetchFeed(candidate);
      if (answer.status === 200 && isFeed(answer.body)) {
        return answer.movedTo ?? candidate;
      }
    } catch {
      // Unreachable candidate: try the next.
    }
  }
  return undefined;
}

/**
 * An article with its full text, fetching and keeping the text the first time
 * it is asked for when the scrape did not fetch it (NewsBlur's original text,
 * on demand), or again when `force` asks for a fresh copy. A page with too
 * little text is remembered as having none, so it is not fetched again. When
 * the story has no picture, the page's lead picture becomes its picture.
 */
export async function withText<
  T extends {
    id: number;
    url: string;
    body_text: string | null;
    image: string | null;
  },
>(db: Database, article: T, force = false): Promise<T> {
  if (article.body_text !== null && !force) return article;
  const page = await get(article.url, 12000);
  const text = articleText(page);
  const body_text = text.length >= MIN_TEXT ? text : '';
  // The page's lead picture stands in for a story the feed gave none.
  const image = article.image
    ? undefined
    : ogImage(page, article.url) || undefined;
  await new Repository(db).setBodyText(article.id, body_text, image);
  return { ...article, body_text, ...(image ? { image } : {}) };
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
        comments_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
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
