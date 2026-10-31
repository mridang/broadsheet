/**
 * @packageDocumentation
 *
 * Read tracking: noting that the signed-in person opened a story, so the
 * paper dims it today and leaves it out of later editions.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { problems, ApiController, created, ok } from '@/lib/core/api';
import { Repository } from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';

/** The signed-in caller's id and the request, for a read endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** A read as the API shows it. */
interface ReadResource {
  readonly article_id: string;
}

/**
 * `POST /api/users/self/reads/:article_id`: note the story as read. 201 with
 * its `Location` the first time, 200 after that, 404 when there is no such
 * article, 401/403 when not signed in or cross-site.
 */
export function createReadItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, { id: number; first: boolean | undefined } | undefined>({
    method: 'POST',
    handle: async (_input, { request, uid }) => {
      const id = parseFeedId(idOf(request));
      if (id === undefined) return undefined;
      return {
        id,
        first: await new Repository(getDatabase()).markRead(uid, id),
      };
    },
    encode: (result) => {
      if (!result || result.first === undefined) {
        return problems.notFound('article');
      }
      const body: ReadResource = { article_id: String(result.id) };
      const at = `/api/users/self/reads/${result.id}`;
      return result.first ? created(body, at) : ok(body, { location: at });
    },
  });
}

/** The read-item controller bound to the production resolver. */
export const readItem = createReadItem();
