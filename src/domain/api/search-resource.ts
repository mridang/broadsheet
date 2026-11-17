/**
 * @packageDocumentation
 *
 * Saved searches on the wire: the representation
 * `/api/users/self/searches` sends, and checking the body a client posts to
 * keep a search.
 */

import { MAX_QUERY_LENGTH } from '@/domain/api/article-resource';
import { parseFeedId, rfc3339 } from '@/domain/api/feed-resource';
import type { SavedSearch } from '@/domain/repository';

/** A saved search as the API shows it. Absent members are unknown, never null. */
export interface SearchResource {
  readonly id: string;
  readonly query: string;
  readonly feed_id?: string;
  /** The archive page this search lists, under `/api/articles`. */
  readonly articles: string;
  readonly created_at?: string;
}

/** The API's view of a stored saved search. */
export function searchResource(search: Readonly<SavedSearch>): SearchResource {
  const created = search.created_at ? rfc3339(search.created_at) : undefined;
  const query = new URLSearchParams({ q: search.query });
  if (search.feed_id !== null) {
    query.set('feed_id', String(search.feed_id));
  }
  return {
    id: String(search.id),
    query: search.query,
    ...(search.feed_id === null ? {} : { feed_id: String(search.feed_id) }),
    articles: `/api/articles?${query}`,
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked saved-search body. */
export interface SearchInput {
  readonly query: string;
  readonly feed_id: number | null;
}

/** A checked saved-search body, or what was wrong with it. */
export type SearchBody =
  | { readonly ok: true; readonly input: SearchInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a saved-search body: `query` non-blank text of at most
 * {@link MAX_QUERY_LENGTH} characters, `feed_id` one of the person's feed ids
 * (checked by the caller), null or absent. Other members are refused.
 */
export function parseSearchInput(
  body: Readonly<Record<string, unknown>>,
): SearchBody {
  const raw = body['query'];
  const query =
    typeof raw === 'string' ? raw.trim().replaceAll(/\s+/gu, ' ') : '';
  const rawFeed = body['feed_id'];
  const id =
    rawFeed !== undefined && rawFeed !== null && typeof rawFeed === 'string'
      ? parseFeedId(rawFeed)
      : undefined;
  const feedId: number | null = id ?? null;
  const errors: string[] = [
    ...Object.keys(body)
      .filter((key) => key !== 'query' && key !== 'feed_id')
      .map((key) => `${key}: not a member of a saved search.`),
    ...(raw === undefined ? ['query: required.'] : []),
    ...(raw !== undefined && !query ? ['query: must be non-blank text.'] : []),
    ...(query.length > MAX_QUERY_LENGTH ? ['query: too long.'] : []),
    ...(rawFeed !== undefined && rawFeed !== null && id === undefined
      ? ['feed_id: not a feed id.']
      : []),
  ];
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, input: { query, feed_id: feedId } };
}
