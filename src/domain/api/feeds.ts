/**
 * @packageDocumentation
 *
 * The feed API as controllers over the `core/api` framework: following a feed,
 * removing one, and refreshing them all. The route files only mount these.
 * Each runs as the signed-in person (the `requireUser` context); a request
 * from another site or with no session is refused there before any handler
 * runs.
 */

import {
  feedResource,
  parseFeedId,
  parseFeedInput,
  type FeedResource,
} from '@/domain/api/feed-resource';
import { readJsonObject, problems } from '@/lib/rest-json';
import { ApiController } from '@/core/api';
import { requireUser, type AuthedContext } from '@/core/auth';
import { Repository, type Feed } from '@/domain/repository';
import { refreshFeed } from '@/domain/scraping/index';
import { getDatabase, getEnv, runInBackground } from '@/core/runtime';
import { appOrigin } from '@/core/origin';

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
export const feedsCollection = new ApiController<AuthedContext>({
  context: (request) => requireUser(request),
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
  handle: async ({ url }, { user }) => {
    const db = getDatabase();
    const repo = new Repository(db);
    const existing = await repo.getFeedByUrl(user.id, url);
    if (existing) {
      return { feed: existing, created: false };
    }
    const feed = await repo.addFeed(user.id, url);
    if (!feed) {
      throw problems.badRequest('The feed could not be added.');
    }
    runInBackground(refreshFeed(db, getEnv(), feed).catch(() => undefined));
    return { feed, created: true };
  },
  encode: (
    { feed, created },
    { request },
  ): {
    status: number;
    body: FeedResource;
    headers: Record<string, string>;
  } => ({
    status: created ? 201 : 200,
    body: feedResource(feed),
    headers: {
      Location: `${appOrigin(request)}/api/feeds/${feed.id}`,
      ...(created ? {} : { 'Cache-Control': 'private, no-cache' }),
    },
  }),
});

/**
 * `DELETE /api/feeds/:id`: stop following the feed. 204, 404 when there is no
 * such feed (or the id cannot name one), 401/403 when not signed in or
 * cross-site.
 */
export const feedItem = new ApiController<AuthedContext>({
  context: (request) => requireUser(request),
}).on<null, boolean>({
  method: 'DELETE',
  handle: async (_input, { request, user }) => {
    const id = parseFeedId(idOf(request));
    return id !== undefined
      ? new Repository(getDatabase()).removeFeed(user.id, id)
      : false;
  },
  encode: (removed) =>
    removed ? { status: 204 } : { response: problems.notFound('feed') },
});

/** The trailing path segment of `/api/feeds/:id`. */
function idOf(request: Request): string {
  const segments = new URL(request.url).pathname.split('/');
  return segments[segments.length - 1] ?? '';
}

/**
 * `POST /api/feeds/refreshes`: fetch every feed the person follows again now.
 * 200 with how many feeds there were and how many refreshed or failed,
 * 401/403 when not signed in or cross-site. A refresh is not stored, so the
 * result is the response (hence 200, not 201).
 */
export const feedRefreshes = new ApiController<AuthedContext>({
  context: (request) => requireUser(request),
}).on<
  null,
  {
    readonly feeds: number;
    readonly refreshed: number;
    readonly failed: number;
  }
>({
  method: 'POST',
  handle: async (_input, { user }) => {
    const db = getDatabase();
    const env = getEnv();
    const feeds = await new Repository(db).listFeeds(user.id);
    const outcomes = await Promise.all(
      feeds.map((feed) =>
        refreshFeed(db, env, feed).then(
          (result) => result.ok,
          () => false,
        ),
      ),
    );
    const refreshed = outcomes.filter(Boolean).length;
    return { feeds: feeds.length, refreshed, failed: feeds.length - refreshed };
  },
  encode: (body) => ({ body, headers: { 'Cache-Control': 'no-store' } }),
});
