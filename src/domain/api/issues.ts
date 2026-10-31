/**
 * @packageDocumentation
 *
 * The issue API as a controller over the `core/api` framework: reading the
 * paper the signed-in person was given on one day, from their default edition
 * (`self`; custom editions take their own id in the same place).
 */

import { issueResource } from '@/domain/api/issue-resource';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { idOf } from '@/domain/api/feeds';
import { problems, ApiController, ok } from '@/lib/core/api';
import { Repository } from '@/domain/repository';
import { getDatabase } from '@/domain/db/database';
import { isIssueDate, storedIssue, type Issue } from '@/domain/issues';

/** The signed-in caller's id and the request, for an issue endpoint. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/**
 * `GET /api/editions/self/issues/:date`: the stored issue of the person's
 * default edition for that day. 200, 404 when no issue was laid out that day
 * (or the date is not a calendar date), 401 when not signed in.
 */
export function createIssueItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, Issue | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const date = idOf(request);
      return isIssueDate(date)
        ? storedIssue(new Repository(getDatabase()), uid, date)
        : undefined;
    },
    encode: (issue) =>
      issue
        ? ok(issueResource(issue), {
            headers: { 'Cache-Control': 'private, no-cache' },
          })
        : problems.notFound('issue'),
  });
}

/** The issue-item controller bound to the production resolver. */
export const issueItem = createIssueItem();
