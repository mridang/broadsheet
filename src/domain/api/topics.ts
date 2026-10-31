/**
 * @packageDocumentation
 *
 * The topic API: the curated list a new reader picks starter feeds from.
 * Signed-in callers only, like the rest of `/api`.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { ApiController, page } from '@/lib/core/api';
import { TOPICS } from '@/domain/topics';

/**
 * `GET /api/topics`: every topic with its starter feeds, as a page (the list is
 * short and fixed, so it is always one page). 401/403 when not signed in.
 */
export function createTopicsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<Request> {
  return new ApiController<Request>({
    context: async (request) => {
      await liveUid(request, resolver);
      return request;
    },
  }).on<null, typeof TOPICS>({
    method: 'GET',
    handle: () => TOPICS,
    encode: (topics) =>
      page(topics, undefined, { 'Cache-Control': 'private, max-age=3600' }),
  });
}

/** The topics controller bound to the production resolver. */
export const topicsCollection = createTopicsCollection();
