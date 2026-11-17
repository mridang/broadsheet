/**
 * @packageDocumentation
 *
 * Trending sources on the wire: the representation `/api/sources` sends, and
 * checking the query a client ranks them with.
 */

import { parseFeedId } from '@/domain/api/feed-resource';
import { sqliteSince, WINDOWS } from '@/domain/api/article-resource';
import { SOURCE_ORDERS } from '@/domain/repository';
import { decodeCursor, MAX_LIMIT, DEFAULT_LIMIT } from '@/lib/core/api';
import type { TrendingWindow } from '@/domain/api/article-resource';
import type {
  SourceOrder,
  SourceTrendingQuery,
  TrendingSource,
} from '@/domain/repository';

/** A source with no story in this many days is stale. */
export const STALE_DAYS = 365;

/**
 * A trending source as the API shows it: its address and how many people
 * read or spent time on it (or its weighted new followers), never who. Following one is `POST
 * /api/feeds` with its `url`.
 */
export interface SourceResource {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly site_url?: string;
  readonly followers: number;
  readonly read_count?: number;
  readonly read_seconds?: number;
  readonly follow_score?: number;
}

/** The member each order puts its count in. */
const COUNT_MEMBER = {
  reads: 'read_count',
  read_time: 'read_seconds',
  follows: 'follow_score',
} as const;

/** The API's view of a trending source, with its count for `order`. */
export function sourceResource(
  source: Readonly<TrendingSource>,
  order: SourceOrder,
): SourceResource {
  return {
    id: String(source.id),
    url: source.url,
    ...(source.title ? { title: source.title } : {}),
    ...(source.site_url ? { site_url: source.site_url } : {}),
    followers: source.followers,
    [COUNT_MEMBER[order]]: source.count,
  };
}

/** A checked trending query, or what was wrong with it. */
export type SourceQueryInput =
  | { readonly ok: true; readonly query: SourceTrendingQuery }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The parameters `GET /api/sources` takes. */
const PARAMETERS = new Set(['order', 'window', 'cursor', 'limit']);

/**
 * Check the query of `GET /api/sources`: `order` (required) one of
 * {@link SOURCE_ORDERS}, `window` day, week (the default) or month, `cursor`
 * one this list issued and `limit` a whole number up to the page maximum.
 * Other parameters are refused.
 */
export function parseSourceQuery(
  params: URLSearchParams,
  now: Date = new Date(),
): SourceQueryInput {
  const order = params.get('order');
  const window = params.get('window') ?? 'week';
  const cursor = params.get('cursor');
  const position = cursor === null ? undefined : decodeCursor(cursor);
  const id = parseFeedId(position?.id ?? '');
  const count = Number(position?.key);
  const badCursor =
    cursor !== null &&
    (id === undefined || !position?.key || !Number.isFinite(count));
  const after: SourceTrendingQuery['after'] =
    cursor !== null && !badCursor && id !== undefined
      ? { count, id }
      : undefined;
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const limitOk = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT;
  const errors: string[] = [
    ...new Set(params.keys())
      .values()
      .filter((key) => !PARAMETERS.has(key))
      .map((key) => `${key}: not a parameter of this list.`),
    ...((SOURCE_ORDERS as readonly (string | null)[]).includes(order)
      ? []
      : [`order: must be one of ${SOURCE_ORDERS.join(', ')}.`]),
    ...(Object.hasOwn(WINDOWS, window)
      ? []
      : ['window: must be day, week or month.']),
    ...(badCursor ? ['cursor: not a cursor of this list.'] : []),
    ...(rawLimit !== null && !limitOk
      ? [`limit: must be a whole number from 1 to ${MAX_LIMIT}.`]
      : []),
  ];
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const days = WINDOWS[window as TrendingWindow];
  return {
    ok: true,
    query: {
      order: order as SourceOrder,
      since: sqliteSince(now, days),
      days,
      now: sqliteSince(now, 0),
      freshSince: sqliteSince(now, STALE_DAYS).slice(0, 10),
      ...(after ? { after } : {}),
      limit,
    },
  };
}
