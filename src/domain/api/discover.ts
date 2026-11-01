/**
 * @packageDocumentation
 *
 * Discovering feeds, after NewsBlur's discover and recommendations:
 *
 * - `GET /api/feeds/trending?kind&days&limit`: popular, rising, hidden-gem
 *   and new sources.
 * - `GET /api/sources?q&limit` (see `api/sources`): search the sources
 *   anyone follows (the feed autocomplete).
 * - `GET /api/podcasts?q&limit`: podcasts by iTunes Search, with their feeds.
 * - `GET /api/subreddits?q&limit`: subreddits by Reddit's search, or its
 *   popular ones without `q`, with their feeds.
 * - `POST /api/feeds/conversions` {url} or {google_news}: the feed of a
 *   newsletter, blog, subreddit or channel address, or a Google News feed.
 * - `GET /api/news/topics`: the Google News topics a feed can follow.
 * - `GET`/`POST /api/feeds/recommendations` and
 *   `PATCH /api/feeds/recommendations/{id}`: feeds put forward for everyone,
 *   approved or declined by a curator (an address in `CURATOR_EMAILS`).
 *
 * Following any of them is `POST /api/feeds` with the feed's address.
 */

import {
  liveUid,
  requestCookieResolver,
  sessionUser,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { rfc3339, parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import {
  convertToFeed,
  GOOGLE_NEWS_TOPICS,
  googleNewsFeed,
  podcastsFrom,
  subredditsFrom,
  type Conversion,
  type Podcast,
  type Subreddit,
} from '@/domain/discover';
import {
  ApiController,
  created,
  ok,
  page,
  parseLimit,
  problem,
  problems,
  readJsonObject,
} from '@/lib/core/api';
import { getEnv } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/database';
import {
  Repository,
  type FeedRecommendation,
  type RankedSource,
  type TrendingKind,
  type User,
} from '@/domain/repository';

/** The signed-in caller's id. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** No-cache, for a personal list. */
const PERSONAL = { 'Cache-Control': 'private, no-cache' };

/** Build the per-request context of a signed-in caller. */
const signedIn =
  (resolver: CurrentUserResolver) =>
  async (request: Request): Promise<UidContext> => ({
    request,
    uid: await liveUid(request, resolver),
  });

/** A list's parameters, refusing any not in `allowed`. */
function params(
  request: Request,
  allowed: readonly string[],
): { readonly get: (key: string) => string | null; readonly limit: number } {
  const query = new URL(request.url).searchParams;
  const errors = [...new Set(query.keys())]
    .filter((key) => !allowed.includes(key) && key !== 'limit')
    .map((key) => `${key}: not a parameter of this list.`);
  if (errors.length) {
    throw problems.badRequest('The request is not valid.', errors);
  }
  const limit = parseLimit(query.get('limit'), 10);
  if (limit instanceof Response) throw limit;
  return { get: (key) => query.get(key), limit };
}

/** A source on the wire, as trending lists and searches show it. */
export interface RankedSourceResource {
  readonly url: string;
  readonly title?: string;
  readonly followers: number;
  readonly followed: boolean;
}

/** The API's view of a ranked source. */
export function rankedSourceResource(
  source: RankedSource,
): RankedSourceResource {
  return {
    url: source.url,
    ...(source.title ? { title: source.title } : {}),
    followers: source.followers,
    followed: source.followed,
  };
}

/** The kinds of trending list. */
const TRENDING: readonly TrendingKind[] = [
  'popular',
  'rising',
  'hidden',
  'new',
];

/**
 * `GET /api/feeds/trending?kind&days&limit`: sources trending by `kind`
 * (`popular` by default) over the last `days` days (7 by default, at most 90),
 * as one page. 400 for a bad parameter, 401 when not signed in.
 */
export function createTrendingFeeds(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    { kind: TrendingKind; days: number; limit: number },
    RankedSource[]
  >({
    method: 'GET',
    decode: (request) => {
      const p = params(request, ['kind', 'days']);
      const kind = (p.get('kind') ?? 'popular') as TrendingKind;
      const days = Number(p.get('days') ?? 7);
      const errors = [
        ...(TRENDING.includes(kind)
          ? []
          : [`kind: one of ${TRENDING.join(', ')}.`]),
        ...(Number.isInteger(days) && days >= 1 && days <= 90
          ? []
          : ['days: a whole number from 1 to 90.']),
      ];
      if (errors.length) {
        throw problems.badRequest('The request is not valid.', errors);
      }
      return { kind, days, limit: p.limit };
    },
    handle: ({ kind, days, limit }, { uid }) =>
      new Repository(getDatabase()).trendingSites(uid, kind, days, limit),
    encode: (items) =>
      page(items.map(rankedSourceResource), undefined, PERSONAL),
  });
}

/** The trending-feeds controller bound to the production resolver. */
export const trendingFeeds = createTrendingFeeds();

/** How long a search service may take, in milliseconds. */
const UPSTREAM_TIMEOUT = 10_000;

/** The 502 for a search service that failed. */
function upstreamFailed(service: string): Response {
  return problem(
    502,
    '/problems/upstream-failed',
    'Bad gateway',
    `${service} did not answer. Try again later.`,
  );
}

/** Fetch JSON from a public search service, or undefined when it fails. */
export async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Broadsheet/1.0 (feed reader)',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
    });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** A search's text, required. */
function searchText(p: ReturnType<typeof params>): string {
  const q = (p.get('q') ?? '').trim();
  if (!q || q.length > 200) {
    throw problems.badRequest('The search is not valid.', [
      'q: from 1 to 200 characters.',
    ]);
  }
  return q;
}

/**
 * `GET /api/podcasts?q&limit`: podcasts found by iTunes Search, each with its
 * feed, as one page. 400 for a bad parameter, 401 when not signed in, 502 when
 * iTunes does not answer.
 */
export function createPodcastsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
  get: typeof fetchJson = fetchJson,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    { q: string; limit: number },
    Podcast[] | Response
  >({
    method: 'GET',
    decode: (request) => {
      const p = params(request, ['q']);
      return { q: searchText(p), limit: p.limit };
    },
    handle: async ({ q, limit }) => {
      const body = await get(
        `https://itunes.apple.com/search?${new URLSearchParams({
          term: q,
          media: 'podcast',
          entity: 'podcast',
          limit: String(limit),
        })}`,
      );
      return body === undefined ? upstreamFailed('iTunes') : podcastsFrom(body);
    },
    encode: (items) =>
      items instanceof Response
        ? items
        : page(items, undefined, { 'Cache-Control': 'private, max-age=300' }),
  });
}

/** The podcasts controller bound to the production resolver. */
export const podcastsCollection = createPodcastsCollection();

/**
 * `GET /api/subreddits?q&limit`: subreddits found by Reddit's search, or its
 * popular ones without `q`, each with its feed, as one page. 400 for a bad
 * parameter, 401 when not signed in, 502 when Reddit does not answer.
 */
export function createSubredditsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
  get: typeof fetchJson = fetchJson,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    { q: string | undefined; limit: number },
    Subreddit[] | Response
  >({
    method: 'GET',
    decode: (request) => {
      const p = params(request, ['q']);
      return {
        q: p.get('q') === null ? undefined : searchText(p),
        limit: p.limit,
      };
    },
    handle: async ({ q, limit }) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (q) query.set('q', q);
      const body = await get(
        `https://www.reddit.com/subreddits/${q ? 'search' : 'popular'}.json?${query}`,
      );
      return body === undefined
        ? upstreamFailed('Reddit')
        : subredditsFrom(body);
    },
    encode: (items) =>
      items instanceof Response
        ? items
        : page(items, undefined, { 'Cache-Control': 'private, max-age=300' }),
  });
}

/** The subreddits controller bound to the production resolver. */
export const subredditsCollection = createSubredditsCollection();

/** Check a conversion request: exactly one of `url` and `google_news`. */
export function parseConversion(
  body: Readonly<Record<string, unknown>>,
): { ok: true; value: Conversion } | { ok: false; errors: string[] } {
  const errors = Object.keys(body)
    .filter((k) => k !== 'url' && k !== 'google_news')
    .map((k) => `${k}: not a member of this request.`);
  if ('url' in body === 'google_news' in body) {
    errors.push('url or google_news: send exactly one.');
  }
  if (errors.length) return { ok: false, errors };
  if ('url' in body) {
    const found =
      typeof body['url'] === 'string' && body['url'].length <= 2000
        ? convertToFeed(body['url'])
        : undefined;
    return found
      ? { ok: true, value: found }
      : { ok: false, errors: ['url: not an address a feed can be found for.'] };
  }
  const news = body['google_news'];
  const n =
    news && typeof news === 'object' && !Array.isArray(news)
      ? (news as Record<string, unknown>)
      : undefined;
  const strings = n
    ? Object.fromEntries(
        Object.entries(n).filter(([, v]) => typeof v === 'string'),
      )
    : {};
  const found = n ? googleNewsFeed(strings) : undefined;
  return found
    ? { ok: true, value: found }
    : {
        ok: false,
        errors: [
          `google_news: {query} or {topic: ${GOOGLE_NEWS_TOPICS.map((t) => t.id).join('|')}}, with an optional two-letter language and region.`,
        ],
      };
}

/**
 * `POST /api/feeds/conversions` {url} or {google_news: {query | topic,
 * language?, region?}}: 200 with the feed found (`feed_url`, `platform`,
 * `title`). Nothing is kept or followed. 400 for something no feed can be
 * found for, 415 for a body that is not JSON, 401/403 when not signed in or
 * cross-site.
 */
export function createFeedConversions(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    Conversion,
    Conversion
  >({
    method: 'POST',
    decode: async (request) => {
      const body = await readJsonObject(
        request,
        'The body must be a JSON object.',
      );
      if (!body.ok) throw body.response;
      const input = parseConversion(body.value);
      if (!input.ok) {
        throw problems.badRequest(
          'No feed can be found for that.',
          input.errors,
        );
      }
      return input.value;
    },
    handle: (conversion) => conversion,
    encode: (body) => ok(body, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The feed-conversions controller bound to the production resolver. */
export const feedConversions = createFeedConversions();

/** `GET /api/news/topics`: the Google News topics, as one page. 401 when not signed in. */
export function createNewsTopics(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    null,
    null
  >({
    method: 'GET',
    handle: () => null,
    encode: () =>
      page(
        GOOGLE_NEWS_TOPICS.map(({ id, name }) => ({ id, name })),
        undefined,
        { 'Cache-Control': 'private, max-age=86400' },
      ),
  });
}

/** The news-topics controller bound to the production resolver. */
export const newsTopics = createNewsTopics();

/** A recommendation on the wire. */
export interface RecommendationResource {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly description: string;
  readonly status: 'pending' | 'approved' | 'declined';
  readonly created_at?: string;
  readonly decided_at?: string;
}

/** The API's view of a recommendation. */
export function recommendationResource(
  r: FeedRecommendation,
): RecommendationResource {
  const at = r.created_at ? rfc3339(r.created_at) : undefined;
  const decided = r.decided_at ? rfc3339(r.decided_at) : undefined;
  return {
    id: String(r.id),
    url: r.url,
    ...(r.title ? { title: r.title } : {}),
    description: r.description,
    status: r.status as RecommendationResource['status'],
    ...(at ? { created_at: at } : {}),
    ...(decided ? { decided_at: decided } : {}),
  };
}

/** Whether this person may approve and decline recommendations. */
export function isCurator(user: Pick<User, 'email'>): boolean {
  const listed = String(
    (getEnv() as unknown as Record<string, unknown>)['CURATOR_EMAILS'] ?? '',
  )
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return listed.includes(user.email.toLowerCase());
}

/** Check a recommendation: an `http(s)` `url`, an optional `title`, a `description`. */
export function parseRecommendation(
  body: Readonly<Record<string, unknown>>,
):
  | { ok: true; value: { url: string; title?: string; description: string } }
  | { ok: false; errors: string[] } {
  const errors = Object.keys(body)
    .filter((k) => !['url', 'title', 'description'].includes(k))
    .map((k) => `${k}: not a member of this request.`);
  const url = body['url'];
  if (
    typeof url !== 'string' ||
    !/^https?:\/\/\S+$/i.test(url) ||
    url.length > 2000
  ) {
    errors.push('url: an http(s) address.');
  }
  const title = body['title'];
  if (
    title !== undefined &&
    (typeof title !== 'string' || title.length > 200)
  ) {
    errors.push('title: at most 200 characters.');
  }
  const description = body['description'];
  if (
    typeof description !== 'string' ||
    !description.trim() ||
    description.length > 1000
  ) {
    errors.push('description: from 1 to 1000 characters.');
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          url: url as string,
          ...(typeof title === 'string' && title.trim()
            ? { title: title.trim() }
            : {}),
          description: (description as string).trim(),
        },
      };
}

/** The signed-in caller, for the recommendation endpoints. */
interface UserContext {
  readonly request: Request;
  readonly user: User;
}

/**
 * `GET /api/feeds/recommendations?status`: recommended feeds, `approved` by
 * default (the newest approved is the feed of the day); a curator may list
 * `pending` and `declined` ones. 400 for a bad status, 403 for a status only
 * curators see.
 *
 * `POST /api/feeds/recommendations` {url, title?, description}: put a feed
 * forward; it waits for a curator. 201 with it and its `Location`. 400 for a
 * bad body, 415 for one that is not JSON.
 *
 * Both answer 401/403 when not signed in or cross-site.
 */
export function createRecommendationsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UserContext> {
  return new ApiController<UserContext>({
    context: async (request) => ({
      request,
      user: await sessionUser(request, resolver),
    }),
  })
    .on<'pending' | 'approved' | 'declined', FeedRecommendation[]>({
      method: 'GET',
      decode: (request, { user }) => {
        const p = params(request, ['status']);
        const status = p.get('status') ?? 'approved';
        if (!['pending', 'approved', 'declined'].includes(status)) {
          throw problems.badRequest('The request is not valid.', [
            'status: pending, approved or declined.',
          ]);
        }
        if (status !== 'approved' && !isCurator(user)) {
          throw problems.forbidden('Only a curator sees those.');
        }
        return status as 'pending' | 'approved' | 'declined';
      },
      handle: (status) =>
        new Repository(getDatabase()).listRecommendations(status),
      encode: (items) =>
        page(items.map(recommendationResource), undefined, PERSONAL),
    })
    .on<
      { url: string; title?: string; description: string },
      FeedRecommendation
    >({
      method: 'POST',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The body must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseRecommendation(body.value);
        if (!input.ok) {
          throw problems.badRequest(
            'The recommendation is not valid.',
            input.errors,
          );
        }
        return input.value;
      },
      handle: (input, { user }) =>
        new Repository(getDatabase()).addRecommendation(user.id, input),
      encode: (r) =>
        created(
          recommendationResource(r),
          `/api/feeds/recommendations/${r.id}`,
          { 'Cache-Control': 'no-store' },
        ),
    });
}

/** The recommendations controller bound to the production resolver. */
export const recommendationsCollection = createRecommendationsCollection();

/**
 * `PATCH /api/feeds/recommendations/:id` {status: approved | declined}: a
 * curator decides on a recommendation. 200 with it. 400 for a bad body, 403
 * for someone who is not a curator, 404 when there is no such recommendation,
 * 415 for a body that is not JSON, 401 when not signed in.
 */
export function createRecommendationItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UserContext> {
  return new ApiController<UserContext>({
    context: async (request) => ({
      request,
      user: await sessionUser(request, resolver),
    }),
  }).on<'approved' | 'declined', FeedRecommendation | undefined>({
    method: 'PATCH',
    decode: async (request, { user }) => {
      if (!isCurator(user)) {
        throw problems.forbidden('Only a curator decides on recommendations.');
      }
      const body = await readJsonObject(
        request,
        'The body must be a JSON object.',
        ['application/merge-patch+json'],
      );
      if (!body.ok) throw body.response;
      const status = body.value['status'];
      const extra = Object.keys(body.value).filter((k) => k !== 'status');
      if ((status !== 'approved' && status !== 'declined') || extra.length) {
        throw problems.badRequest('The change is not valid.', [
          'status: approved or declined, and nothing else.',
        ]);
      }
      return status;
    },
    handle: (status, { request }) => {
      const id = parseFeedId(idOf(request));
      return id === undefined
        ? undefined
        : new Repository(getDatabase()).decideRecommendation(id, status);
    },
    encode: (r) =>
      r
        ? ok(recommendationResource(r), {
            headers: { 'Cache-Control': 'no-store' },
          })
        : problems.notFound('recommendation'),
  });
}

/** The recommendation-item controller bound to the production resolver. */
export const recommendationItem = createRecommendationItem();
