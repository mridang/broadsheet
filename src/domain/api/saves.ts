/**
 * @packageDocumentation
 *
 * Saved stories: the person's saves, listed by tag, added and removed. A save
 * is keyed by the article it keeps. Each runs as the signed-in person.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { MAX_QUERY_LENGTH } from '@/domain/api/article-resource';
import { newestPage, pageRequest, type PageRequest } from '@/domain/api/paging';
import {
  parseSaveInput,
  parseSaveTagInput,
  saveResource,
  type SaveBody,
} from '@/domain/api/save-resource';
import {
  readJsonObject,
  problems,
  ApiController,
  ok,
  created,
  noContent,
  page,
  type Slice,
} from '@/lib/core/api';
import { Repository, type SavedStory } from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';
import { fireWebhooks } from '@/domain/notify';

/** The signed-in caller's id and the request, for a save endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** What a save keeps: its tags, and its notes and highlights when sent. */
type SaveContent = Omit<Extract<SaveBody, { ok: true }>, 'ok'>;

/** A page request narrowed to one tag or one feed's source. */
interface SaveQuery extends PageRequest {
  readonly tag: string | undefined;
  readonly sourceId: number | undefined;
  readonly q: string;
}

/**
 * The source of the feed a `feed_id` parameter names; a feed the person does
 * not follow is thrown as a 400.
 */
async function feedSource(
  raw: string | null,
  uid: number,
): Promise<number | undefined> {
  if (raw === null) return undefined;
  const id = parseFeedId(raw);
  const feed =
    id === undefined
      ? undefined
      : await new Repository(getDatabase()).getFeed(uid, id);
  if (!feed) {
    throw problems.badRequest('The feed is not one you follow.', [
      'feed_id: no such feed.',
    ]);
  }
  return feed.source_id;
}

/**
 * The body of a save, which may be left out: no body and no `Content-Type`
 * is a save with no tags.
 */
async function optionalObject(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.has('content-type') && !(await request.clone().text()))
    return {};
  const body = await readJsonObject(request, 'The save must be a JSON object.');
  if (!body.ok) throw body.response;
  return body.value;
}

/**
 * `GET /api/users/self/saves?q&tag&feed_id&limit&cursor`: the person's saved
 * stories, newest save first, only those with `tag` or from the feed
 * `feed_id` when given, and matching `q` (words, `author:` and `tag:`). 400 for a bad limit, cursor or too long a `q`, or a feed the person
 * does not follow, 401 when not signed in.
 */
export function createSavesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<SaveQuery, Slice<SavedStory>>({
    method: 'GET',
    decode: async (request, { uid }) => {
      const query = new URL(request.url).searchParams;
      const q = (query.get('q') ?? '').trim();
      if (q.length > MAX_QUERY_LENGTH) {
        throw problems.badRequest('The search is too long.', ['q: too long.']);
      }
      return {
        ...pageRequest(request),
        tag: query.get('tag') || undefined,
        sourceId: await feedSource(query.get('feed_id'), uid),
        q,
      };
    },
    handle: async ({ tag, sourceId, q, ...paging }, { uid }) =>
      newestPage(
        await new Repository(getDatabase()).listSaves(uid, tag, sourceId, q),
        (s) => ({ key: s.saved_at ?? '', id: String(s.article.id) }),
        paging,
      ),
    encode: (slice) =>
      page(
        slice.items.map((item) => saveResource(item)),
        slice.next,
        {
          'Cache-Control': 'no-store',
        },
      ),
  });
}

/** The save-collection controller bound to the production resolver. */
export const savesCollection = createSavesCollection();

/**
 * `POST /api/users/self/saves/:article_id` {tags?, notes?, highlights?}: keep
 * the story. 201 with the save and its `Location`; 200 when it was saved
 * already (its tags now the ones sent, and its notes and highlights when
 * sent); 400 for a body that is not a valid save, 415 for a body that is not
 * JSON.
 *
 * `DELETE /api/users/self/saves/:article_id`: stop keeping it. 204.
 *
 * Both answer 404 when there is no such article or save, and 401/403 when not
 * signed in or cross-site.
 */
export function createSaveItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<SaveContent, { story: SavedStory; created: boolean } | undefined>({
      method: 'POST',
      decode: async (request) => {
        const input = parseSaveInput(await optionalObject(request));
        if (!input.ok) {
          throw problems.badRequest('The save is not valid.', input.errors);
        }
        return {
          tags: input.tags,
          notes: input.notes,
          highlights: input.highlights,
        };
      },
      handle: async ({ tags, notes, highlights }, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        const repo = new Repository(getDatabase());
        const saved =
          id === undefined ? undefined : await repo.saveArticle(uid, id, tags);
        const annotated =
          saved && (notes !== undefined || highlights !== undefined)
            ? await repo.annotateSave(uid, id!, {
                ...(notes === undefined ? {} : { notes }),
                ...(highlights === undefined ? {} : { highlights }),
              })
            : undefined;
        const result = saved && {
          ...saved,
          story: annotated ?? saved.story,
        };
        if (result) fireWebhooks(uid, 'save', saveResource(result.story));
        return result;
      },
      encode: (result) => {
        if (!result) return problems.notFound('article');
        const body = saveResource(result.story);
        const at = `/api/users/self/saves/${body.article_id}`;
        return result.created ? created(body, at) : ok(body, { location: at });
      },
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new Repository(getDatabase()).unsaveArticle(uid, id);
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('save')),
    });
}

/** The save-item controller bound to the production resolver. */
export const saveItem = createSaveItem();

/** A tag on the person's saves as the API shows it. */
interface SaveTagResource {
  readonly name: string;
  readonly count: number;
}

/**
 * `GET /api/users/self/saves/tags`: every tag on the person's saves with how
 * many saves carry it, by name. 401 when not signed in.
 */
export function createSaveTagsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, readonly SaveTagResource[]>({
    method: 'GET',
    handle: async (_input, { uid }) => {
      const counts = await new Repository(getDatabase()).savedTagCounts(uid);
      return counts.map((t) => ({
        name: t.tag,
        count: t.count,
      }));
    },
    encode: (items) =>
      ok({ items }, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The save-tags controller bound to the production resolver. */
export const saveTagsCollection = createSaveTagsCollection();

/** The tag a `/saves/tags/:name` path names. */
function tagOf(request: Request): string {
  try {
    return decodeURIComponent(idOf(request));
  } catch {
    return '';
  }
}

/**
 * `PATCH /api/users/self/saves/tags/:name` {name}: rename the tag on every
 * save carrying it (merging into a tag of that name). 200 with the tag as it
 * is now, 400 for a body that is not a valid tag, 415 for a non-JSON body.
 *
 * `DELETE /api/users/self/saves/tags/:name`: take the tag off every save; the
 * saves stay. 204.
 *
 * Both answer 404 when no save carries the tag, and 401/403 when not signed
 * in or cross-site.
 */
export function createSaveTagItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<string, SaveTagResource | undefined>({
      method: 'PATCH',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The tag must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseSaveTagInput(body.value);
        if (!input.ok) {
          throw problems.badRequest('The tag is not valid.', input.errors);
        }
        return input.name;
      },
      handle: async (name, { request, uid }) => {
        const repo = new Repository(getDatabase());
        if (!(await repo.retagSaves(uid, tagOf(request), name))) {
          return undefined;
        }
        const counts = await repo.savedTagCounts(uid);
        const tag = counts.find((t) => t.tag === name);
        return tag ? { name, count: tag.count } : undefined;
      },
      encode: (tag) =>
        tag
          ? ok(tag, { headers: { 'Cache-Control': 'no-store' } })
          : problems.notFound('tag'),
    })
    .on<null, number>({
      method: 'DELETE',
      handle: (_input, { request, uid }) =>
        new Repository(getDatabase()).retagSaves(
          uid,
          tagOf(request),
          undefined,
        ),
      encode: (changed) => (changed ? noContent() : problems.notFound('tag')),
    });
}

/** The save-tag controller bound to the production resolver. */
export const saveTagItem = createSaveTagItem();

/** How many saves came from one of the person's feeds. */
interface SaveFeedResource {
  readonly feed_id: string;
  readonly count: number;
}

/**
 * `GET /api/users/self/saves/feeds`: how many of the person's saves came from
 * each feed they follow. 401 when not signed in.
 */
export function createSaveFeedsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, readonly SaveFeedResource[]>({
    method: 'GET',
    handle: async (_input, { uid }) => {
      const repo = new Repository(getDatabase());
      const [counts, feeds] = await Promise.all([
        repo.savedSourceCounts(uid),
        repo.listFeeds(uid),
      ]);
      return feeds.flatMap((feed) => {
        const count = counts.find((c) => c.source_id === feed.source_id);
        return count ? [{ feed_id: String(feed.id), count: count.count }] : [];
      });
    },
    encode: (items) =>
      ok({ items }, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The save-feeds controller bound to the production resolver. */
export const saveFeedsCollection = createSaveFeedsCollection();
