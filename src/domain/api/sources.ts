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
import { problems, ApiController, page, parseLimit } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import { rankedSourceResource } from '@/domain/api/discover';
import {
  Repository,
  type RankedSource,
  type SourceTrendingQuery,
  type TrendingSource,
} from '@/domain/repository';

/** A search of the sources anyone follows: its text and how many to list. */
interface SourceSearch {
  readonly q: string;
  readonly limit: number;
}

/**
 * Check a search of `GET /api/sources?q&limit` (NewsBlur's feed
 * autocomplete): `q` from 2 to 200 characters, `limit` a page size, and no
 * other parameter.
 */
export function parseSourceSearch(
  params: URLSearchParams,
): { ok: true; search: SourceSearch } | { ok: false; errors: string[] } {
  const errors = [...new Set(params.keys())]
    .filter((key) => key !== 'q' && key !== 'limit')
    .map((key) => `${key}: not a parameter of a search.`);
  const q = (params.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 200)
    errors.push('q: from 2 to 200 characters.');
  const limit = parseLimit(params.get('limit'), 10);
  if (limit instanceof Response) errors.push('limit: not a valid page size.');
  return errors.length || limit instanceof Response
    ? { ok: false, errors }
    : { ok: true, search: { q, limit } };
}

/**
 * `GET /api/sources?order=&window=&cursor=&limit=`: the trending sources,
 * most first. With `q` instead, `GET /api/sources?q=&limit=`: the sources
 * anyone follows whose title or address holds `q`, most followed first, each
 * saying whether the caller follows it, as one page. 200 with
 * `{self, next?, items}`, 400 for a bad parameter, 401 when not signed in.
 */
export function createSourcesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<{ readonly uid: number }> {
  return new ApiController<{ readonly uid: number }>({
    context: async (request) => ({ uid: await liveUid(request, resolver) }),
  }).on<
    SourceTrendingQuery | SourceSearch,
    | { query: SourceTrendingQuery; rows: TrendingSource[] }
    | { found: RankedSource[] }
  >({
    method: 'GET',
    decode: (request) => {
      const params = new URL(request.url).searchParams;
      if (params.has('q')) {
        const search = parseSourceSearch(params);
        if (!search.ok) {
          throw problems.badRequest('The search is not valid.', search.errors);
        }
        return search.search;
      }
      const input = parseSourceQuery(params);
      if (!input.ok) {
        throw problems.badRequest('The list is not valid.', input.errors);
      }
      return input.query;
    },
    handle: async (query, { uid }) =>
      'q' in query
        ? {
            found: await new Repository(getDatabase()).searchSources(
              uid,
              query.q,
              query.limit,
            ),
          }
        : {
            query,
            rows: await new Repository(getDatabase()).trendingSources(query),
          },
    encode: (result) => {
      if ('found' in result) {
        return page(result.found.map(rankedSourceResource), undefined, {
          'Cache-Control': 'private, no-cache',
        });
      }
      const { query, rows } = result;
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
