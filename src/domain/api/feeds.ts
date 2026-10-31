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
import { refreshSource } from '@/domain/scraping/index';
import { getEnv, runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/database';
import {
  buildOpml,
  OPML_TYPE,
  parseOpml,
  type OpmlFeed,
} from '@/domain/api/opml';
import { importFeeds, MAX_IMPORT_FEEDS } from '@/domain/feed-import';
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
    const index = accepted.findIndex((a) => a.split(';')[0]?.trim() === type);
    return index < 0 ? Infinity : index;
  };
  return rank(OPML_TYPE) < rank('application/json');
}

/** The feeds as an OPML download, folders being the sections. */
function opmlResponse({ feeds, sections }: FeedList): Response {
  const names = new Map(sections.map((s) => [s.id, s.name]));
  const xml = buildOpml(
    'Broadsheet feeds',
    feeds.map((f) => ({
      url: f.url,
      title: f.title ?? f.url,
      ...(f.section_id !== null && names.has(f.section_id)
        ? { section: names.get(f.section_id) }
        : {}),
    })),
    sections.map((s) => s.name),
  );
  return new Response(xml, {
    headers: {
      'Content-Type': `${OPML_TYPE}; charset=utf-8`,
      'Content-Disposition': 'attachment; filename="broadsheet.opml"',
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
  const sorted = [...feeds].sort((a, b) => a.id - b.id);
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
        const existing = await repo.getFeedByUrl(uid, url);
        if (existing) {
          return { feed: existing, created: false };
        }
        const feed = await repo.addFeed(uid, url);
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
 * `PATCH /api/feeds/:id`: rename, mute or file the feed under a section
 * (`title`, `muted`, `section_id`; null clears the title or section). 200 with
 * the feed, 400 for a body that is not a valid change or names a section that
 * is not the person's, 415 for a non-JSON body.
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
        if (
          typeof changes.section_id === 'number' &&
          !(await repo.getSection(uid, changes.section_id))
        ) {
          throw problems.badRequest('The change is not valid.', [
            'section_id: no such section.',
          ]);
        }
        return repo.updateFeed(uid, id, changes);
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
        return id !== undefined
          ? new Repository(getDatabase()).removeFeed(uid, id)
          : false;
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('feed')),
    });
}

/** The feed-item controller bound to the production resolver. */
export const feedItem = createFeedItem();

/** The trailing path segment of `/api/feeds/:id`. */
export function idOf(request: Request): string {
  const segments = new URL(request.url).pathname.split('/');
  return segments[segments.length - 1] ?? '';
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
  return parseFeedId(segments[segments.length - 2] ?? '');
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
  }).on<null, FeedStatistics | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const id = statisticsId(request);
      return id === undefined
        ? undefined
        : new Repository(getDatabase()).feedStatistics(uid, id);
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

/** The API's view of {@link FeedStatistics}; absent members are unknown. */
function statisticsResource(stats: FeedStatistics): Record<string, unknown> {
  const fetched = stats.last_fetched_at
    ? rfc3339(stats.last_fetched_at)
    : undefined;
  return {
    ...(fetched ? { last_fetched_at: fetched } : {}),
    ...(stats.last_error ? { last_error: stats.last_error } : {}),
    fail_count: stats.fail_count,
    stories_per_day: stats.stories_per_day,
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
    if (unknown.length) {
      throw problems.badRequest('The import is not valid.', [
        `topic_ids: no such topic: ${unknown.slice(0, 5).join(', ')}.`,
      ]);
    }
    const feeds = ids.flatMap((id: string) => {
      const topic = findTopic(id)!;
      return topic.feeds.map((f) => ({
        url: f.url,
        title: f.title,
        section: topic.name,
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

/**
 * `POST /api/feeds/imports`: follow many feeds at once, from an OPML file
 * (`text/x-opml`, `text/xml` or `application/xml`, at most 1 MiB and 500 feeds;
 * folders become sections) or from `{topic_ids}` as JSON. 201 with `Location`
 * (the feeds) and a summary of what was added, skipped and rejected; 400 for
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
  }).on<ImportInput, Awaited<ReturnType<typeof importFeeds>>>({
    method: 'POST',
    decode: decodeImport,
    handle: async (input, { uid }) => {
      const db = getDatabase();
      const summary = await importFeeds(new Repository(db), uid, input.feeds);
      const env = getEnv();
      for (const feed of summary.feeds.slice(0, FIRST_FETCHES)) {
        runInBackground(
          refreshSource(db, env, sourceOf(feed)).catch(() => undefined),
        );
      }
      return summary;
    },
    encode: (summary) =>
      created(
        {
          added: summary.added,
          skipped: summary.skipped,
          sections_added: summary.sections_added,
          rejected: summary.rejected,
        },
        '/api/feeds',
        { 'Cache-Control': 'no-store' },
      ),
  });
}

/** The imports controller bound to the production resolver. */
export const feedImports = createFeedImports();
