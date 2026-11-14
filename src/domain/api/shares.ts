/**
 * @packageDocumentation
 *
 * Shared stories: anyone signed in lists the shares, everyone's or chosen
 * people's, and a person shares a story from their feeds with a comment, or
 * stops sharing it. A share is keyed by the article it shares.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { pageRequest, type PageRequest } from '@/domain/api/paging';
import {
  parseShareInput,
  parseSharerIds,
  shareResource,
} from '@/domain/api/share-resource';
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
import { Repository } from '@/domain/repository';
import { ShareRepository, type SharedStory } from '@/domain/shares';
import { getDatabase } from '@/domain/db/client';

/** The signed-in caller's id and the request, for a share endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** A page request narrowed to some sharers. */
interface ShareQuery extends PageRequest {
  readonly userIds: readonly number[] | undefined;
}

/**
 * The body of a share, which may be left out: no body and no `Content-Type`
 * is a share with no comment.
 */
async function optionalObject(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.has('content-type') && !(await request.clone().text()))
    return {};
  const body = await readJsonObject(
    request,
    'The share must be a JSON object.',
  );
  if (!body.ok) throw body.response;
  return body.value;
}

/** A share's place in the newest-first list: its id, as shares never move. */
const positionOf = (s: SharedStory) => ({
  key: s.shared_at ?? '',
  id: String(s.id),
});

/**
 * `GET /api/shares?user_id&limit&cursor`: the stories people shared, newest
 * first, only those of the people `user_id` names when given. 400 for a bad
 * parameter, 401 when not signed in.
 */
export function createSharesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<ShareQuery, Slice<SharedStory>>({
    method: 'GET',
    decode: async (request) => {
      const sharers = parseSharerIds(
        new URL(request.url).searchParams.getAll('user_id'),
      );
      if (!sharers.ok) {
        throw problems.badRequest('The query is not valid.', sharers.errors);
      }
      return { ...pageRequest(request), userIds: sharers.ids };
    },
    handle: async ({ userIds, after, limit }) => {
      const rows = await new ShareRepository(getDatabase()).list({
        limit,
        ...(userIds ? { userIds } : {}),
        ...(after ? { before: Number(after.id) } : {}),
      });
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return rows.length > limit && last
        ? { items, next: positionOf(last) }
        : { items };
    },
    encode: (slice) =>
      page(
        slice.items.map((share) => shareResource(share)),
        slice.next,
        {
          'Cache-Control': 'no-store',
        },
      ),
  });
}

/** The share-collection controller bound to the production resolver. */
export const sharesCollection = createSharesCollection();

/**
 * `POST /api/users/self/shares/:article_id` {comments?}: share a story from
 * the person's feeds. 201 with the share and its `Location`; 200 when it was
 * shared already (its comment now the one sent); 400 for a body that is not a
 * valid share, 415 for one that is not JSON.
 *
 * `DELETE /api/users/self/shares/:article_id`: stop sharing it. 204.
 *
 * Both answer 404 when there is no such article or share, and 401/403 when
 * not signed in or cross-site.
 */
export function createShareItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<
      { comments: string | null },
      { story: SharedStory; created: boolean } | undefined
    >({
      method: 'POST',
      decode: async (request) => {
        const input = parseShareInput(await optionalObject(request));
        if (!input.ok) {
          throw problems.badRequest('The share is not valid.', input.errors);
        }
        return { comments: input.comments };
      },
      handle: async ({ comments }, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        const db = getDatabase();
        if (id === undefined || !(await new Repository(db).getArticle(uid, id)))
          return undefined;
        return new ShareRepository(db).share(uid, id, comments);
      },
      encode: (result) => {
        if (!result) return problems.notFound('article');
        const body = shareResource(result.story);
        const at = `/api/users/self/shares/${body.article_id}`;
        return result.created ? created(body, at) : ok(body, { location: at });
      },
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new ShareRepository(getDatabase()).unshare(uid, id);
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('share')),
    });
}

/** The share-item controller bound to the production resolver. */
export const shareItem = createShareItem();
