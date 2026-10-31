/**
 * @packageDocumentation
 *
 * Articles on the wire: the representation `/api/articles` sends, and checking
 * the query a client searches the archive with.
 */

import { parseFeedId } from '@/domain/api/feed-resource';
import type {
  Article,
  ArticleQuery,
  ArticleSummary,
} from '@/domain/repository';
import { decodeCursor, MAX_LIMIT, DEFAULT_LIMIT } from '@/lib/core/api';

/** Longest search text accepted, in characters. */
export const MAX_QUERY_LENGTH = 200;

/** An article as a list shows it. Absent members are unknown, never null. */
export interface ArticleResource {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly source?: string;
  readonly image?: string;
  readonly summary?: string;
  readonly published_at?: string;
  readonly edition?: string;
  readonly points: number;
}

/** One article on its own, with the readable text of its page. */
export interface ArticleDetailResource extends ArticleResource {
  readonly body_text?: string;
}

/** A stored timestamp as RFC 3339, or undefined when it does not parse. */
function timestamp(stored: string | null): string | undefined {
  if (!stored) return undefined;
  const ms = Date.parse(stored);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** The API's view of a stored article, without its body text. */
export function articleResource(
  article: Readonly<ArticleSummary>,
): ArticleResource {
  const published = timestamp(article.published_at);
  return {
    id: String(article.id),
    url: article.url,
    ...(article.title ? { title: article.title } : {}),
    ...(article.source ? { source: article.source } : {}),
    ...(article.image ? { image: article.image } : {}),
    ...(article.summary ? { summary: article.summary } : {}),
    ...(published ? { published_at: published } : {}),
    ...(article.edition ? { edition: article.edition } : {}),
    points: article.points ?? 0,
  };
}

/** The API's view of one stored article, with its body text. */
export function articleDetailResource(
  article: Readonly<Article>,
): ArticleDetailResource {
  return {
    ...articleResource(article),
    ...(article.body_text ? { body_text: article.body_text } : {}),
  };
}

/** A checked search query, or what was wrong with it. */
export type ArticleQueryInput =
  | { readonly ok: true; readonly query: ArticleQuery }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check the query of `GET /api/articles`: `q` at most
 * {@link MAX_QUERY_LENGTH} characters, `cursor` one this API issued, `limit` a
 * whole number from 1 to the page maximum. Other parameters are refused.
 */
export function parseArticleQuery(params: URLSearchParams): ArticleQueryInput {
  const errors: string[] = [];
  for (const key of new Set(params.keys())) {
    if (key !== 'q' && key !== 'cursor' && key !== 'limit') {
      errors.push(`${key}: not a parameter of this search.`);
    }
  }
  const q = (params.get('q') ?? '').trim();
  if (q.length > MAX_QUERY_LENGTH) errors.push('q: too long.');
  let before: number | undefined;
  const cursor = params.get('cursor');
  if (cursor !== null) {
    before = parseFeedId(decodeCursor(cursor)?.id ?? '');
    if (before === undefined) errors.push('cursor: not a cursor of this list.');
  }
  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      errors.push(`limit: must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, query: { q, before, limit } };
}
