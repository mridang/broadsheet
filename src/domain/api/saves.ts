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
import { newestPage, pageRequest, type PageRequest } from '@/domain/api/paging';
import { parseSaveInput, saveResource } from '@/domain/api/save-resource';
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

/** The signed-in caller's id and the request, for a save endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** A page request narrowed to one tag. */
interface SaveQuery extends PageRequest {
  readonly tag: string | undefined;
}

/**
 * The body of a save, which may be left out: no body and no `Content-Type`
 * is a save with no tags.
 */
async function optionalObject(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  if (!request.headers.has('content-type')) {
    if (!(await request.clone().text())) return {};
  }
  const body = await readJsonObject(request, 'The save must be a JSON object.');
  if (!body.ok) throw body.response;
  return body.value;
}

/**
 * `GET /api/users/self/saves?tag&limit&cursor`: the person's saved stories,
 * newest save first, only those with `tag` when given. 400 for a bad limit or
 * cursor, 401 when not signed in.
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
    decode: (request) => ({
      ...pageRequest(request),
      tag: new URL(request.url).searchParams.get('tag') ?? undefined,
    }),
    handle: async ({ tag, ...paging }, { uid }) =>
      newestPage(
        await new Repository(getDatabase()).listSaves(uid, tag),
        (s) => ({ key: s.saved_at ?? '', id: String(s.article.id) }),
        paging,
      ),
    encode: (slice) =>
      page(slice.items.map(saveResource), slice.next, {
        'Cache-Control': 'no-store',
      }),
  });
}

/** The save-collection controller bound to the production resolver. */
export const savesCollection = createSavesCollection();

/**
 * `POST /api/users/self/saves/:article_id` {tags?}: keep the story. 201 with
 * the save and its `Location`; 200 when it was saved already (its tags now the
 * ones sent); 400 for a body that is not a valid save, 415 for a body that is
 * not JSON.
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
    .on<readonly string[], { story: SavedStory; created: boolean } | undefined>(
      {
        method: 'POST',
        decode: async (request) => {
          const input = parseSaveInput(await optionalObject(request));
          if (!input.ok) {
            throw problems.badRequest('The save is not valid.', input.errors);
          }
          return input.tags;
        },
        handle: async (tags, { request, uid }) => {
          const id = parseFeedId(idOf(request));
          return id !== undefined
            ? new Repository(getDatabase()).saveArticle(uid, id, tags)
            : undefined;
        },
        encode: (result) => {
          if (!result) return problems.notFound('article');
          const body = saveResource(result.story);
          const at = `/api/users/self/saves/${body.article_id}`;
          return result.created
            ? created(body, at)
            : ok(body, { location: at });
        },
      },
    )
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id !== undefined
          ? new Repository(getDatabase()).unsaveArticle(uid, id)
          : false;
      },
      encode: (removed) => (removed ? noContent() : problems.notFound('save')),
    });
}

/** The save-item controller bound to the production resolver. */
export const saveItem = createSaveItem();
