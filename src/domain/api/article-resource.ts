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
  TrendingArticle,
  TrendingQuery,
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

/**
 * An article as the trending list shows it: how many people read or saved it
 * in the window, never who.
 */
export interface TrendingArticleResource extends ArticleResource {
  readonly read_count?: number;
  readonly save_count?: number;
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

/** The API's view of a trending article, with its count for `order`. */
export function trendingArticleResource(
  { article, count }: Readonly<TrendingArticle>,
  order: TrendingQuery['order'],
): TrendingArticleResource {
  return {
    ...articleResource(article),
    ...(order === 'reads' ? { read_count: count } : { save_count: count }),
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

/** How far back each trending window reaches, in days. */
export const WINDOWS = { day: 1, week: 7, month: 30 } as const;

/** A trending window the API accepts. */
export type TrendingWindow = keyof typeof WINDOWS;

/** What `order` may be: newest first, or most read or saved. */
const ORDERS = new Set(['newest', 'reads', 'saves']);

/** The parameters `GET /api/articles` takes. */
const PARAMETERS = new Set(['q', 'cursor', 'limit', 'order', 'window']);

/**
 * A checked article query, or what was wrong with it. With `trending`, the
 * list is ranked by reads or saves instead of searched newest first.
 */
export type ArticleQueryInput =
  | {
      readonly ok: true;
      readonly query: ArticleQuery;
      readonly trending?: TrendingQuery;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

/** `days` before `now` as a SQLite time, as `datetime('now')` writes them. */
export function sqliteSince(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

/**
 * Check the query of `GET /api/articles`: `q` at most
 * {@link MAX_QUERY_LENGTH} characters, `cursor` one this API issued, `limit` a
 * whole number from 1 to the page maximum, `order` `newest` (the default),
 * `reads` or `saves`, and `window` (`day`, `week` or `month`, a week by
 * default) only with a ranked order, which takes no `q`. Other parameters are
 * refused.
 */
export function parseArticleQuery(
  params: URLSearchParams,
  now: Date = new Date(),
): ArticleQueryInput {
  const errors: string[] = [];
  for (const key of new Set(params.keys())) {
    if (!PARAMETERS.has(key)) {
      errors.push(`${key}: not a parameter of this search.`);
    }
  }
  const order = params.get('order') ?? 'newest';
  if (!ORDERS.has(order)) errors.push('order: must be newest, reads or saves.');
  const ranked = order === 'reads' || order === 'saves';
  const window = params.get('window');
  if (window !== null) {
    if (!ranked) errors.push('window: only with order reads or saves.');
    else if (!Object.hasOwn(WINDOWS, window)) {
      errors.push('window: must be day, week or month.');
    }
  }
  const q = (params.get('q') ?? '').trim();
  if (q.length > MAX_QUERY_LENGTH) errors.push('q: too long.');
  if (q && ranked) errors.push('q: not with order reads or saves.');
  let before: number | undefined;
  let after: TrendingQuery['after'];
  const cursor = params.get('cursor');
  if (cursor !== null) {
    const position = decodeCursor(cursor);
    before = parseFeedId(position?.id ?? '');
    const count = Number(position?.key);
    if (before === undefined || (ranked && !Number.isInteger(count))) {
      errors.push('cursor: not a cursor of this list.');
    } else if (ranked) after = { count, id: before };
  }
  let limit = DEFAULT_LIMIT;
  const rawLimit = params.get('limit');
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      errors.push(`limit: must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  if (!ranked) return { ok: true, query: { q, before, limit } };
  const days = WINDOWS[(window ?? 'week') as TrendingWindow];
  return {
    ok: true,
    query: { q, limit },
    trending: {
      order,
      since: sqliteSince(now, days),
      ...(after ? { after } : {}),
      limit,
    },
  };
}
