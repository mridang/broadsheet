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
  problems,
  ApiController,
  ok,
  created,
  noContent,
} from '@/lib/core/api';
import { Repository, type Feed, type FeedChanges } from '@/domain/repository';
import { refreshSource } from '@/domain/scraping/index';
import { getEnv, runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/database';

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

/**
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
  }).on<{ readonly url: string }, FollowResult>({
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
