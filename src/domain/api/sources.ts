/**
 * @packageDocumentation
 *
 * Trending sources: `GET /api/sources?order=` ranks the feeds people across
 * the app read, spend time on, or newly follow, like NewsBlur's trending
 * feeds. It shows only counts, never who.
 */

import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseSourceQuery, sourceResource } from '@/domain/api/source-resource';
import { problems, ApiController, page } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import {
  Repository,
  type SourceTrendingQuery,
  type TrendingSource,
} from '@/domain/repository';

/**
 * `GET /api/sources?order=&window=&cursor=&limit=`: the trending sources,
 * most first. 200 with `{self, next?, items}`, 400 for a bad parameter, 401
 * when not signed in.
 */
export function createSourcesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<{ readonly uid: number }> {
  return new ApiController<{ readonly uid: number }>({
    context: async (request) => ({ uid: await liveUid(request, resolver) }),
  }).on<
    SourceTrendingQuery,
    { query: SourceTrendingQuery; rows: TrendingSource[] }
  >({
    method: 'GET',
    decode: (request) => {
      const input = parseSourceQuery(new URL(request.url).searchParams);
      if (!input.ok) {
        throw problems.badRequest('The list is not valid.', input.errors);
      }
      return input.query;
    },
    handle: async (query) => ({
      query,
      rows: await new Repository(getDatabase()).trendingSources(query),
    }),
    encode: ({ query, rows }) => {
      const items = rows.slice(0, query.limit);
      const last = rows.length > query.limit ? items.at(-1) : undefined;
      return page(
        items.map((s) => sourceResource(s, query.order)),
        last ? { key: String(last.count), id: String(last.id) } : undefined,
        { 'Cache-Control': 'private, no-cache' },
      );
    },
  });
}

/** The sources controller bound to the production resolver. */
export const sourcesCollection = createSourcesCollection();
