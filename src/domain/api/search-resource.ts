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
  if (search.feed_id !== null) query.set('feed_id', String(search.feed_id));
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
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (key !== 'query' && key !== 'feed_id') {
      errors.push(`${key}: not a member of a saved search.`);
    }
  }
  const raw = body['query'];
  const query =
    typeof raw === 'string' ? raw.trim().replaceAll(/\s+/g, ' ') : '';
  if (raw === undefined) errors.push('query: required.');
  else if (!query) errors.push('query: must be non-blank text.');
  else if (query.length > MAX_QUERY_LENGTH) errors.push('query: too long.');
  else {
    // the query is non-blank and within the length limit
  }
  const rawFeed = body['feed_id'];
  let feedId: number | null = null;
  if (rawFeed !== undefined && rawFeed !== null) {
    const id = typeof rawFeed === 'string' ? parseFeedId(rawFeed) : undefined;
    if (id === undefined) errors.push('feed_id: not a feed id.');
    else feedId = id;
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, input: { query, feed_id: feedId } };
}
