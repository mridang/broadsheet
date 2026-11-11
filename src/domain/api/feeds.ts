/**
 * @packageDocumentation
 *
 * The feed API as controllers over the `core/api` framework: following a feed,
 * removing one, and refreshing them all. The route files only mount these.
 * Each runs as the signed-in person: the caller's id is resolved from the
 * request through a {@link CurrentUserResolver} (`liveUid`), and a request from
 * another site or with no live session is refused before any handler runs.
 * Each controller is a factory defaulting to the production
 * {@link requestCookieResolver}, so a test can inject a fake resolver.
 */

import {
  feedResource,
  rfc3339,
  parseFeedChanges,
  parseFeedId,
  parseFeedInput,
} from '@/domain/api/feed-resource';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import {
  readJsonObject,
  readBodyText,
  problems,
  problem,
  page,
  parseLimit,
  decodeCursor,
  sliceAfter,
  ApiController,
  type ApiResponse,
  ok,
  accepted,
  created,
  noContent,
} from '@/lib/core/api';
import {
  Repository,
  type Feed,
  type FeedChanges,
  type Section,
  type FeedStatistics,
} from '@/domain/repository';
import {
  feedClassifierCounts,
  type ClassifierCounts,
} from '@/domain/classifier-counts';
import { discoverFeed, refreshSource } from '@/domain/scraping/index';
import { getEnv, runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/database';
import {
  buildOpml,
  OPML_TYPE,
  parseOpml,
  type OpmlEntry,
  type OpmlFeed,
} from '@/domain/api/opml';
import {
  importFeeds,
  MAX_IMPORT_FEEDS,
  type ImportSummary,
} from '@/domain/feed-import';
import {
  FeedImportRuns,
  IMPORT_CHUNK,
  type ImportRun,
} from '@/domain/feed-import-runs';
import { findTopic } from '@/domain/topics';

/** The signed-in caller's id and the request, for a feed endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** A followed feed, and whether this request created it. */
interface FollowResult {
  readonly feed: Feed;
  readonly created: boolean;
}

/** The person's feeds with their sections, for the list and its OPML form. */
interface FeedList {
  readonly feeds: readonly Feed[];
  readonly sections: readonly Section[];
}

/** Whether the client asked for OPML ahead of JSON. */
export function wantsOpml(request: Request): boolean {
  const accepted = (request.headers.get('accept') ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase());
  const rank = (type: string): number => {
    const index = accepted.findIndex(
      (a) => a.split(';', 1)[0]?.trim() === type,
    );
    return index === -1 ? Infinity : index;
  };
  return rank(OPML_TYPE) < rank('application/json');
}

/** The feeds as an OPML download, folders being the sections. */
function opmlResponse({ feeds, sections }: FeedList): Response {
  // A feed filed in several sections is listed in each, as NewsBlur does.
  const xml = buildOpml(
    'Broadsheet feeds',
    feeds.flatMap((f) => {
      const entry = {
        url: f.url,
        title: f.title ?? f.url,
        ...(f.site_url ? { site_url: f.site_url } : {}),
      };
      return f.section_ids.length > 0
        ? f.section_ids.map((id): OpmlEntry => ({ ...entry, section_id: id }))
        : [{ ...entry, section_id: null }];
    }),
    sections,
  );
  return new Response(xml, {
    headers: {
      'Content-Type': `${OPML_TYPE}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="broadsheet-${new Date().toISOString().slice(0, 10)}.opml"`,
      'Cache-Control': 'private, no-store',
      Vary: 'Accept',
    },
  });
}

/** One cursor page of feeds, in id order. */
function feedPage(
  feeds: readonly Feed[],
  request: Request,
): ApiResponse<unknown> | Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'));
  if (limit instanceof Response) return limit;
  const raw = url.searchParams.get('cursor');
  const after = raw ? decodeCursor(raw) : undefined;
  if (raw && !after) {
    return problems.badRequest('The cursor is not valid.', [
      'cursor: not valid.',
    ]);
  }
  const sorted = feeds.toSorted((a, b) => a.id - b.id);
  const slice = sliceAfter(
    sorted,
    (f) => ({ key: String(f.id), id: String(f.id) }),
    (a, b) => Number(a.id) - Number(b.id),
    after,
    limit,
  );
  return page(slice.items.map(feedResource), slice.next, {
    Vary: 'Accept',
    'Cache-Control': 'private, no-cache',
  });
}

/**
 * `GET /api/feeds`: the person's feeds as a cursor page of JSON, or as an OPML
 * file when the request sends `Accept: text/x-opml` (sections become folders).
 *
 * `POST /api/feeds`: follow a feed. 201 with the new feed and its `Location`
 * (its first edition is fetched in the background), 200 with the existing feed
 * when the person already follows that address, 400 for a body that is not a
 * valid feed, 401/403 when not signed in or cross-site, 415 for a non-JSON body.
 */
export function createFeedsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<null, FeedList>({
      method: 'GET',
      handle: async (_input, { uid }) => {
        const repo = new Repository(getDatabase());
        const [feeds, sections] = await Promise.all([
          repo.listFeeds(uid),
          repo.listSections(uid),
        ]);
        return { feeds, sections };
      },
      encode: (list, { request }) =>
        wantsOpml(request) ? opmlResponse(list) : feedPage(list.feeds, request),
    })
    .on<{ readonly url: string }, FollowResult>({
      method: 'POST',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The feed must be a JSON object.',
        );
        if (!body.ok) {
          throw body.response;
        }
        const input = parseFeedInput(body.value);
        if (!input.ok) {
          throw problems.badRequest('The feed is not valid.', input.errors);
        }
        return { url: input.url };
      },
      handle: async ({ url }, { uid }) => {
        const db = getDatabase();
        const repo = new Repository(db);
        const typed = await repo.getFeedByUrl(uid, url);
        if (typed) {
          return { feed: typed, created: false };
        }
        // A page's address follows the feed it declares, as NewsBlur does.
        const found = await discoverFeed(url);
        if (!found) {
          throw problems.badRequest('The feed could not be added.', [
            'url: no feed was found at this address.',
          ]);
        }
        const existing = await repo.getFeedByUrl(uid, found);
        if (existing) {
          return { feed: existing, created: false };
        }
        const feed = await repo.addFeed(uid, found);
        if (!feed) {
          throw problems.badRequest('The feed could not be added.');
        }
        runInBackground(
          refreshSource(db, getEnv(), sourceOf(feed)).catch(() => undefined),
        );
        return { feed, created: true };
      },
      encode: ({ feed, created: isNew }) =>
        isNew
          ? created(feedResource(feed), `/api/feeds/${feed.id}`)
          : ok(feedResource(feed), {
              location: `/api/feeds/${feed.id}`,
              headers: { 'Cache-Control': 'private, no-cache' },
            }),
    });
}

/** The feed-collection controller bound to the production resolver. */
export const feedsCollection = createFeedsCollection();

/**
 * `PATCH /api/feeds/:id`: rename, mute (for good or `muted_until` a time),
 * reorder, give an icon or auto mark-read days, or file the feed under one
 * section (`section_id`) or several (`section_ids`). 200 with the feed, 400
 * for a body that is not a valid change or names a section that is not the
 * person's, 415 for a non-JSON body.
 *
 * `DELETE /api/feeds/:id`: stop following the feed. 204.
 *
 * Both answer 404 when there is no such feed (or the id cannot name one), and
 * 401/403 when not signed in or cross-site.
 */
export function createFeedItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<FeedChanges, Feed | undefined>({
      method: 'PATCH',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The change must be a JSON object.',
        );
        if (!body.ok) {
          throw body.response;
        }
        const input = parseFeedChanges(body.value);
        if (!input.ok) {
          throw problems.badRequest('The change is not valid.', input.errors);
        }
        return input.changes;
      },
      handle: async (changes, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        if (id === undefined) return undefined;
        const repo = new Repository(getDatabase());
        if (!(await repo.getFeed(uid, id))) return undefined;
        await checkSections(repo, uid, changes);
        if (changes.url !== undefined) {
          const current = await repo.getFeed(uid, id);
          if (!current) return undefined;
          let address: string = changes.url;
          if (address !== current.url) {
            // A page's address follows the feed it declares (NewsBlur's
            // "change feed link").
            const found = await discoverFeed(address);
            if (!found) {
              throw problems.badRequest('The change is not valid.', [
                'url: no feed was found at this address.',
              ]);
            }
            address = found;
          }
          changes = { ...changes, url: address };
          const taken = await repo.getFeedByUrl(uid, address);
          if (taken && taken.id !== id) {
            throw problem(
              409,
              '/problems/conflict',
              'Conflict',
              'The person already follows a feed at that address.',
              { errors: ['url: already followed.'] },
            );
          }
          if (address === current.url) {
            const { url: _same, ...rest } = changes;
            void _same;
            return repo.updateFeed(uid, id, rest);
          }
        }
        const updated = await repo.updateFeed(uid, id, changes);
        if (updated && changes.url !== undefined) {
          runInBackground(
            refreshSource(getDatabase(), getEnv(), sourceOf(updated)).catch(
              () => undefined,
            ),
          );
        }
        return updated;
      },
      encode: (feed) =>
        feed
          ? ok(feedResource(feed), {
              headers: { 'Cache-Control': 'no-store' },
            })
          : problems.notFound('feed'),
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new Repository(getDatabase()).removeFeed(uid, id);
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('feed')),
    });
}

/** The feed-item controller bound to the production resolver. */
export const feedItem = createFeedItem();

/**
 * Refuse a change that files a feed under a section that is not the
 * person's, naming the member that did.
 */
async function checkSections(
  repo: Repository,
  uid: number,
  changes: FeedChanges,
): Promise<void> {
  const mine = new Set((await repo.listSections(uid)).map((s) => s.id));
  if (typeof changes.section_id === 'number' && !mine.has(changes.section_id)) {
    throw problems.badRequest('The change is not valid.', [
      'section_id: no such section.',
    ]);
  }
  if (changes.section_ids?.some((s) => !mine.has(s))) {
    throw problems.badRequest('The change is not valid.', [
      'section_ids: no such section.',
    ]);
  }
}

/** The trailing path segment of `/api/feeds/:id`. */
export function idOf(request: Request): string {
  const segments = new URL(request.url).pathname.split('/');
  return segments.at(-1) ?? '';
}

/** The source a feed reads from, as the scraper fetches it. */
function sourceOf(feed: Feed): { readonly id: number; readonly url: string } {
  return { id: feed.source_id, url: feed.url };
}

/**
 * `POST /api/feeds/refreshes`: fetch every feed the person follows again now.
 * 200 with how many feeds there were and how many refreshed or failed,
 * 401/403 when not signed in or cross-site. A refresh is not stored, so the
 * result is the response (hence 200, not 201).
 */
export function createFeedRefreshes(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<
    null,
    {
      readonly feeds: number;
      readonly refreshed: number;
      readonly failed: number;
    }
  >({
    method: 'POST',
    handle: async (_input, { uid }) => {
      const db = getDatabase();
      const env = getEnv();
      const feeds = await new Repository(db).listFeeds(uid);
      const outcomes = await Promise.all(
        feeds.map((feed) =>
          refreshSource(db, env, sourceOf(feed)).then(
            (result) => result.ok,
            () => false,
          ),
        ),
      );
      const refreshed = outcomes.filter(Boolean).length;
      return {
        feeds: feeds.length,
        refreshed,
        failed: feeds.length - refreshed,
      };
    },
    encode: (body) => ok(body, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The feed-refreshes controller bound to the production resolver. */
export const feedRefreshes = createFeedRefreshes();

/** The id in a `/api/feeds/:id/statistics` path, or undefined. */
function statisticsId(request: Request): number | undefined {
  const segments = new URL(request.url).pathname.split('/');
  return parseFeedId(segments.at(-2) ?? '');
}

/**
 * `GET /api/feeds/:id/statistics`: how the feed's source is doing: last fetch,
 * last error, failures in a row and stories per day. 404 when there is no such
 * feed, 401/403 when not signed in or cross-site.
 */
export function createFeedStatistics(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, CountedStatistics | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const id = statisticsId(request);
      return id === undefined
        ? undefined
        : countedStatistics(new Repository(getDatabase()), uid, id);
    },
    encode: (stats) =>
      stats
        ? ok(statisticsResource(stats), {
            headers: { 'Cache-Control': 'private, no-cache' },
          })
        : problems.notFound('feed'),
  });
}

/** The statistics controller bound to the production resolver. */
export const feedStatistics = createFeedStatistics();

/** A feed's statistics with its unread stories counted by verdict. */
export type CountedStatistics = FeedStatistics & {
  readonly classifier_counts: ClassifierCounts;
};

/** The statistics of one of the person's feeds with its classifier counts. */
async function countedStatistics(
  repo: Repository,
  uid: number,
  id: number,
): Promise<CountedStatistics | undefined> {
  const [feed, stats] = await Promise.all([
    repo.getFeed(uid, id),
    repo.feedStatistics(uid, id),
  ]);
  if (!feed || !stats) return undefined;
  return {
    ...stats,
    classifier_counts: await feedClassifierCounts(repo, uid, feed),
  };
}

/** The API's view of {@link CountedStatistics}; absent members are unknown. */
export function statisticsResource(
  stats: CountedStatistics,
): Record<string, unknown> {
  const fetched = stats.last_fetched_at
    ? rfc3339(stats.last_fetched_at)
    : undefined;
  return {
    ...(fetched ? { last_fetched_at: fetched } : {}),
    ...(stats.last_error ? { last_error: stats.last_error } : {}),
    fail_count: stats.fail_count,
    ...(stats.update_minutes === null
      ? {}
      : { update_minutes: stats.update_minutes }),
    subscribers: stats.subscribers,
    active_subscribers: stats.active_subscribers,
    story_count: stats.story_count,
    stories_last_month: stats.stories_last_month,
    average_stories_per_month: stats.average_stories_per_month,
    stories_per_day: stats.stories_per_day,
    stories_per_month: stats.stories_per_month,
    stories_per_weekday: stats.stories_per_weekday,
    stories_per_hour: stats.stories_per_hour,
    ...(stats.next_fetch_at
      ? { next_fetch_at: rfc3339(stats.next_fetch_at) }
      : {}),
    archive_count: stats.archive_count,
    classifier_counts: stats.classifier_counts,
    ...(stats.fetch_history[0]?.duration_ms == null
      ? {}
      : { last_load_time_ms: stats.fetch_history[0].duration_ms }),
    fetch_history: stats.fetch_history.map((h) => ({
      ...((h.fetched_at ? rfc3339(h.fetched_at) : undefined)
        ? { fetched_at: rfc3339(h.fetched_at!) }
        : {}),
      ok: h.ok,
      ...(h.message ? { message: h.message } : {}),
      ...(h.duration_ms === null ? {} : { duration_ms: h.duration_ms }),
    })),
  };
}

/** Largest OPML upload accepted, in bytes. */
export const MAX_OPML_BYTES = 1024 * 1024;

/** What an import request names: OPML text or topic ids. */
type ImportInput =
  | { readonly kind: 'opml'; readonly feeds: readonly OpmlFeed[] }
  | { readonly kind: 'topics'; readonly feeds: readonly OpmlFeed[] };

/** The feeds a request body asks to import, or the problem thrown. */
async function decodeImport(request: Request): Promise<ImportInput> {
  const [essence = ''] = (request.headers.get('content-type') ?? '').split(';');
  const type = essence.trim().toLowerCase();
  if (type === 'application/json') {
    const body = await readJsonObject(
      request,
      'The import must be a JSON object.',
    );
    if (!body.ok) throw body.response;
    const ids = body.value['topic_ids'];
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 50 ||
      !ids.every((id) => typeof id === 'string')
    ) {
      throw problems.badRequest('The import is not valid.', [
        'topic_ids: required, a list of 1 to 50 topic ids.',
      ]);
    }
    const unknown = ids.filter((id: string) => !findTopic(id));
    if (unknown.length > 0) {
      throw problems.badRequest('The import is not valid.', [
        `topic_ids: no such topic: ${unknown.slice(0, 5).join(', ')}.`,
      ]);
    }
    const feeds = ids.flatMap((id: string) => {
      const topic = findTopic(id)!;
      return topic.feeds.map((f) => ({
        url: f.url,
        title: f.title,
        sections: [topic.name],
      }));
    });
    return { kind: 'topics', feeds };
  }
  if (!['text/x-opml', 'text/xml', 'application/xml'].includes(type)) {
    throw problems.unsupportedMediaType(
      'application/json, text/x-opml, text/xml or application/xml',
    );
  }
  const text = await readBodyText(request, MAX_OPML_BYTES);
  if (text.kind === 'too-large') {
    throw problem(
      413,
      '/problems/payload-too-large',
      'Payload too large',
      `The OPML file must be at most ${MAX_OPML_BYTES / 1024} KiB.`,
    );
  }
  if (text.kind !== 'ok') {
    throw problems.badRequest('The OPML file is not valid UTF-8.');
  }
  const parsed = parseOpml(text.text);
  if (!parsed.ok) {
    throw problems.badRequest('The OPML file is not valid.', parsed.errors);
  }
  if (parsed.feeds.length > MAX_IMPORT_FEEDS) {
    throw problems.badRequest('The OPML file has too many feeds.', [
      `body: at most ${MAX_IMPORT_FEEDS} feeds.`,
    ]);
  }
  return { kind: 'opml', feeds: parsed.feeds };
}

/** How many newly followed feeds are fetched straight away. */
const FIRST_FETCHES = 10;

/** Where an import's progress is watched. */
const importPath = (id: string): string => `/api/feeds/imports/${id}`;

/**
 * `POST /api/feeds/imports`: follow many feeds at once, from an OPML file
 * (`text/x-opml`, `text/xml` or `application/xml`, at most 1 MiB and 500 feeds;
 * folders become sections) or from `{topic_ids}` as JSON. 201 with `Location`
 * (the feeds) and a summary of what was added, skipped and rejected; for a
 * file of more than {@link IMPORT_CHUNK} feeds, 202 with `Location` (the
 * import) and its progress, as the feeds are followed in a Workflow. 400 for
 * input that is not valid, 413 for an oversized file, 415 for another type.
 */
export function createFeedImports(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<
    ImportInput,
    | { readonly kind: 'done'; readonly summary: ImportSummary }
    | { readonly kind: 'started'; readonly run: ImportRun }
  >({
    method: 'POST',
    decode: decodeImport,
    handle: async (input, { uid }) => {
      const db = getDatabase();
      const env = getEnv();
      if (input.kind === 'opml' && input.feeds.length > IMPORT_CHUNK) {
        const runs = new FeedImportRuns(db);
        const run = await runs.start(uid, input.feeds.length);
        try {
          await env.FEED_IMPORTS.create({
            id: run.id,
            params: { id: run.id, user: uid, feeds: input.feeds },
          });
        } catch (error) {
          await runs.finish(run.id, 'failed');
          throw error;
        }
        return { kind: 'started', run };
      }
      const summary = await importFeeds(new Repository(db), uid, input.feeds);
      for (const feed of summary.feeds.slice(0, FIRST_FETCHES)) {
        runInBackground(
          refreshSource(db, env, sourceOf(feed)).catch(() => undefined),
        );
      }
      return { kind: 'done', summary };
    },
    encode: (result) =>
      result.kind === 'started'
        ? accepted(result.run, importPath(result.run.id), {
            'Cache-Control': 'no-store',
          })
        : created(
            {
              added: result.summary.added,
              skipped: result.summary.skipped,
              sections_added: result.summary.sections_added,
              rejected: result.summary.rejected,
            },
            '/api/feeds',
            { 'Cache-Control': 'no-store' },
          ),
  });
}

/**
 * `GET /api/feeds/imports/:id`: how far one of the person's imports got and
 * what it did so far; `status` turns `complete` (or `failed`) when it is done.
 * 404 when there is no such import, 401/403 when not signed in or cross-site.
 */
export function createFeedImportItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, ImportRun | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const id = new URL(request.url).pathname.split('/').at(-1) ?? '';
      return new FeedImportRuns(getDatabase()).find(uid, id);
    },
    encode: (run) =>
      run
        ? ok(run, { headers: { 'Cache-Control': 'no-store' } })
        : problems.notFound('import'),
  });
}

/** The import progress controller bound to the production resolver. */
export const feedImportItem = createFeedImportItem();

/** The imports controller bound to the production resolver. */
export const feedImports = createFeedImports();

/**
 * `POST /api/feeds/:id/refreshes`: fetch one feed again now, forgetting its
 * failures first, as the way out of a broken feed. 200 with its statistics
 * once the fetch worked, 502 when it failed again (the statistics say why),
 * 404 when there is no such feed.
 */
export function createFeedRetries(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, Response | undefined>({
    method: 'POST',
    handle: async (_input, { request, uid }) => {
      const id = statisticsId(request);
      const repo = new Repository(getDatabase());
      const feed = id === undefined ? undefined : await repo.getFeed(uid, id);
      if (!feed) return undefined;
      await repo.clearFailures(feed.source_id);
      const outcome = await refreshSource(
        getDatabase(),
        getEnv(),
        sourceOf(feed),
      );
      const stats = await countedStatistics(repo, uid, feed.id);
      return outcome.ok && stats
        ? Response.json(statisticsResource(stats), {
            headers: { 'Cache-Control': 'no-store' },
          })
        : problem(
            502,
            '/problems/upstream-failed',
            'Bad gateway',
            `The feed could not be fetched: ${stats?.last_error ?? 'unknown error'}`,
          );
    },
    encode: (response) => response ?? problems.notFound('feed'),
  });
}

/** The retry controller bound to the production resolver. */
export const feedRetries = createFeedRetries();
/** Most feeds one move or removal may name. */
const MAX_BATCH = 500;

/** A checked list of feed ids from the member `feed_ids` of a body. */
function feedIdsOf(body: Readonly<Record<string, unknown>>): number[] | string {
  const raw = body['feed_ids'];
  const ids = Array.isArray(raw)
    ? raw.map((r) => (typeof r === 'string' ? parseFeedId(r) : undefined))
    : undefined;
  return ids &&
    ids.length > 0 &&
    ids.length <= MAX_BATCH &&
    ids.every((id) => id !== undefined)
    ? (ids as number[])
    : `feed_ids: a list of 1 to ${MAX_BATCH} feed ids.`;
}

/** What a move asks: these feeds, under this section (null for none). */
interface FeedMove {
  readonly feed_ids: readonly number[];
  readonly section_id: number | null;
}

/**
 * `POST /api/feeds/moves` {feed_ids, section_id}: file several feeds under one
 * section (null for none) at once, as NewsBlur moves a selection of feeds into
 * a folder. Their other sections stay. 200 with how many moved (ids that are
 * not the person's are skipped), 400 for a body that is not a valid move or a
 * section that is not theirs, 415 for a non-JSON body, 401/403 when not signed
 * in or cross-site. A move is not stored, so the result is the response.
 */
export function createFeedMoves(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<FeedMove, { readonly moved: number }>({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The move must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const errors: string[] = [];
      for (const key of Object.keys(body.value)) {
        if (key !== 'feed_ids' && key !== 'section_id') {
          errors.push(`${key}: not a member of a move.`);
        }
      }
      const ids = feedIdsOf(body.value);
      if (typeof ids === 'string') errors.push(ids);
      const raw = body.value['section_id'];
      const section = typeof raw === 'string' ? parseFeedId(raw) : undefined;
      if (raw !== null && section === undefined) {
        errors.push('section_id: a section id, or null for none.');
      }
      if (errors.length > 0 || typeof ids === 'string') {
        throw problems.badRequest('The move is not valid.', errors);
      }
      return { feed_ids: ids, section_id: section ?? null };
    },
    handle: async ({ feed_ids: ids, section_id: section }, { uid }) => {
      const repo = new Repository(getDatabase());
      await checkSections(repo, uid, { section_id: section });
      return { moved: await repo.moveFeeds(uid, ids, section) };
    },
    encode: (body) => ok(body, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The feed-moves controller bound to the production resolver. */
export const feedMoves = createFeedMoves();

/**
 * `POST /api/feeds/removals` {feed_ids}: stop following several feeds at once.
 * 200 with how many there were to remove (ids that are not the person's are
 * skipped), 400 for a body that is not a valid list, 415 for a non-JSON body,
 * 401/403 when not signed in or cross-site.
 */
export function createFeedRemovals(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<readonly number[], { readonly removed: number }>({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The removal must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const extra = Object.keys(body.value)
        .filter((key) => key !== 'feed_ids')
        .map((key) => `${key}: not a member of a removal.`);
      const ids = feedIdsOf(body.value);
      if (extra.length > 0 || typeof ids === 'string') {
        throw problems.badRequest('The removal is not valid.', [
          ...extra,
          ...(typeof ids === 'string' ? [ids] : []),
        ]);
      }
      return ids;
    },
    handle: async (ids, { uid }) => ({
      removed: await new Repository(getDatabase()).removeFeeds(uid, ids),
    }),
    encode: (body) => ok(body, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The feed-removals controller bound to the production resolver. */
export const feedRemovals = createFeedRemovals();
