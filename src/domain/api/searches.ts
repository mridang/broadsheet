/**
 * @packageDocumentation
 *
 * Saved searches as controllers over the `core/api` framework: the archive
 * searches a person keeps (NewsBlur's saved searches), each optionally within
 * one of their feeds, listed, kept and forgotten. Each runs as the signed-in
 * person.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { newestPage, pageRequest, type PageRequest } from '@/domain/api/paging';
import {
  parseSearchInput,
  searchResource,
  type SearchInput,
} from '@/domain/api/search-resource';
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
import { Repository, type SavedSearch } from '@/domain/repository';
import { getDatabase } from '@/domain/db/client';

/** The signed-in caller's id and the request, for a saved-search endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

const location = (s: SavedSearch) => `/api/users/self/searches/${s.id}`;

/**
 * `GET /api/users/self/searches`: the person's saved searches, newest first,
 * one page at a time. 400 for a bad cursor or limit.
 *
 * `POST /api/users/self/searches` {query, feed_id?}: keep a search. 201 with
 * it and its `Location`, 200 with the same search when it was kept before, 400
 * for a body that is not a valid search or names a feed that is not the
 * person's, 415 for a non-JSON body.
 *
 * Both answer 401/403 when not signed in or cross-site.
 */
export function createSearchesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<PageRequest, Slice<SavedSearch>>({
      method: 'GET',
      decode: (request) => pageRequest(request),
      handle: async (paging, { uid }) =>
        newestPage(
          await new Repository(getDatabase()).listSearches(uid),
          (s) => ({ key: s.created_at ?? '', id: String(s.id) }),
          paging,
        ),
      encode: (slice) =>
        page(
          slice.items.map((search) => searchResource(search)),
          slice.next,
          {
            'Cache-Control': 'no-store',
          },
        ),
    })
    .on<SearchInput, { search: SavedSearch; created: boolean }>({
      method: 'POST',
      decode: async (request) => {
        const body = await readJsonObject(
          request,
          'The saved search must be a JSON object.',
        );
        if (!body.ok) throw body.response;
        const input = parseSearchInput(body.value);
        if (!input.ok) {
          throw problems.badRequest(
            'The saved search is not valid.',
            input.errors,
          );
        }
        return input.input;
      },
      handle: async ({ query, feed_id }, { uid }) => {
        const repo = new Repository(getDatabase());
        if (feed_id !== null && !(await repo.getFeed(uid, feed_id))) {
          throw problems.badRequest('The saved search is not valid.', [
            'feed_id: no such feed.',
          ]);
        }
        return repo.addSearch(uid, query, feed_id);
      },
      encode: ({ search, created: isNew }) =>
        isNew
          ? created(searchResource(search), location(search))
          : ok(searchResource(search), { location: location(search) }),
    });
}

/** The saved-search collection controller bound to the production resolver. */
export const searchesCollection = createSearchesCollection();

/**
 * `DELETE /api/users/self/searches/:id`: forget a saved search. 204, 404 when
 * the person has no such search (or the id cannot name one), 401/403 when not
 * signed in or cross-site.
 */
export function createSearchItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, boolean>({
    method: 'DELETE',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(idOf(request));
      return id === undefined
        ? false
        : new Repository(getDatabase()).removeSearch(uid, id);
    },
    encode: (removed) =>
      removed ? noContent() : problems.notFound('saved search'),
  });
}

/** The saved-search item controller bound to the production resolver. */
export const searchItem = createSearchItem();
