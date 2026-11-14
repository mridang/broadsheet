/**
 * @packageDocumentation
 *
 * Dashboard rivers: the story lists a person pins to the columns of their
 * front page, listed, pinned one at a time or all at once, and removed, as
 * NewsBlur's dashboard rivers are. Each runs as the signed-in person; a river
 * may only list the person's own feeds, sections, saved searches and
 * editions.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import {
  parseRiverInput,
  parseRiverList,
  riverResource,
} from '@/domain/api/river-resource';
import {
  readJsonObject,
  problems,
  ApiController,
  ok,
  created,
  noContent,
  page,
} from '@/lib/core/api';
import { getDatabase, type Database } from '@/domain/db/client';
import {
  ownsTarget,
  parseRiverId,
  RiverRepository,
  type River,
  type RiverInput,
} from '@/domain/rivers';

/** The signed-in caller's id and the request, for a river endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** Read a JSON object body; a bad one is thrown as its problem. */
async function bodyOf(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  const body = await readJsonObject(
    request,
    'The river must be a JSON object.',
  );
  if (!body.ok) throw body.response;
  return body.value;
}

/** Refuse rivers that list something not the caller's, naming each. */
async function checkOwned(
  db: Database,
  uid: number,
  list: readonly RiverInput[],
): Promise<void> {
  const errors: string[] = [];
  for (const river of list) {
    if (!(await ownsTarget(db, uid, parseRiverId(river.river_id)!))) {
      errors.push(`river_id: no such ${river.river_id}.`);
    }
  }
  if (errors.length > 0) {
    throw problems.badRequest('The river is not valid.', errors);
  }
}

/** The person's rivers as one page; there are never more than a page. */
const listPage = (rivers: readonly River[]) =>
  page(
    rivers.map((river) => riverResource(river)),
    undefined,
    { 'Cache-Control': 'no-store' },
  );

/**
 * `GET /api/users/self/rivers`: the person's rivers, the left column then the
 * right, each in order. 401 when not signed in.
 *
 * `POST /api/users/self/rivers` {river_id, side, position}: pin a river there,
 * or change what the river already there lists. 201 with it and its
 * `Location`, or 200 when the place was taken.
 *
 * `PUT /api/users/self/rivers` {items}: replace every river at once. 200 with
 * them.
 *
 * Writes answer 400 for a bad body or a river that lists something not the
 * caller's, 401/403 when not signed in or cross-site, 415 for a non-JSON
 * body.
 */
export function createRiversCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  })
    .on<null, River[]>({
      method: 'GET',
      handle: (_input, { uid }) => new RiverRepository(getDatabase()).list(uid),
      encode: listPage,
    })
    .on<RiverInput, { river: River; created: boolean }>({
      method: 'POST',
      decode: async (request) => {
        const input = parseRiverInput(await bodyOf(request));
        if (!input.ok) {
          throw problems.badRequest('The river is not valid.', input.errors);
        }
        return input.value;
      },
      handle: async (input, { uid }) => {
        const db = getDatabase();
        await checkOwned(db, uid, [input]);
        return new RiverRepository(db).place(uid, input);
      },
      encode: ({ river, created: isNew }) => {
        const at = `/api/users/self/rivers/${river.id}`;
        return isNew
          ? created(riverResource(river), at)
          : ok(riverResource(river), { location: at });
      },
    })
    .on<RiverInput[], River[]>({
      method: 'PUT',
      decode: async (request) => {
        const input = parseRiverList(await bodyOf(request));
        if (!input.ok) {
          throw problems.badRequest('The rivers are not valid.', input.errors);
        }
        return input.value;
      },
      handle: async (list, { uid }) => {
        const db = getDatabase();
        await checkOwned(db, uid, list);
        return new RiverRepository(db).replace(uid, list);
      },
      encode: listPage,
    });
}

/** The river collection controller bound to the production resolver. */
export const riversCollection = createRiversCollection();

/**
 * `DELETE /api/users/self/rivers/:id`: unpin the river; the ones below it in
 * its column move up. 204, 404 when the caller has no such river, 401/403
 * when not signed in or cross-site.
 */
export function createRiverItem(
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
        : new RiverRepository(getDatabase()).remove(uid, id);
    },
    encode: (removed) => (removed ? noContent() : problems.notFound('river')),
  });
}

/** The river item controller bound to the production resolver. */
export const riverItem = createRiverItem();
