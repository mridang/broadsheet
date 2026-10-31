/**
 * @packageDocumentation
 *
 * Paging a person's list newest first: reading `limit` and `cursor` from the
 * query and slicing the page that follows the cursor.
 */

import {
  decodeCursor,
  parseLimit,
  problems,
  sliceAfter,
  type CursorPosition,
  type Slice,
} from '@/lib/core/api';

/** Where a page starts and how long it is, from the request's query. */
export interface PageRequest {
  readonly after: CursorPosition | undefined;
  readonly limit: number;
}

/** Read `limit` and `cursor`; a bad one is thrown as its 400. */
export function pageRequest(request: Request): PageRequest {
  const query = new URL(request.url).searchParams;
  const limit = parseLimit(query.get('limit'));
  if (limit instanceof Response) throw limit;
  const cursor = query.get('cursor');
  const after = cursor === null ? undefined : decodeCursor(cursor);
  if (cursor !== null && !after) {
    throw problems.badRequest('The cursor is not one this API issued.', [
      'cursor: not valid.',
    ]);
  }
  return { after, limit };
}

/**
 * Order positions newest first: a later key (an RFC 3339 or SQLite time
 * sorts as text) comes first, then a higher numeric id.
 */
function newestFirst(a: CursorPosition, b: CursorPosition): number {
  if (a.key !== b.key) return a.key < b.key ? 1 : -1;
  return Number(b.id) - Number(a.id);
}

/** The page of a newest-first list that `page` asks for. */
export function newestPage<T>(
  sorted: readonly T[],
  positionOf: (item: T) => CursorPosition,
  page: PageRequest,
): Slice<T> {
  return sliceAfter(sorted, positionOf, newestFirst, page.after, page.limit);
}
