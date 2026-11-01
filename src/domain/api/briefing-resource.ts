/**
 * @packageDocumentation
 *
 * Briefings on the wire: the representation `/api/editions/self/briefings`
 * sends for each briefing, with the stories it covers and whether the
 * person has read them, and checking the list's query.
 */

import {
  CATEGORIES,
  parseBriefedStories,
  type Category,
} from '@/domain/briefing';
import type { Article, StoredBriefing } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';
import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor } from '@/lib/core/api';
import { parseFeedId } from '@/domain/api/feed-resource';

/** A story a briefing covers. */
export interface BriefingStoryResource {
  readonly article_id: string;
  readonly category: Category;
  readonly title?: string;
  readonly url?: string;
  readonly source?: string;
  readonly read: boolean;
}

/** A briefing. Absent members are unknown, never null. */
export interface BriefingResource {
  readonly id: string;
  readonly title: string;
  readonly slot: string;
  readonly local_date: string;
  readonly frequency: string;
  readonly period_start: string;
  readonly status: 'complete' | 'failed';
  readonly summary?: string;
  readonly error?: string;
  readonly sections: readonly Category[];
  readonly stories: readonly BriefingStoryResource[];
  readonly model?: string;
  readonly tokens?: number;
  readonly seconds?: number;
  readonly created_at?: string;
}

/** A briefing in the operator's list: whose, and how much it covers. */
export interface BriefingAuditResource {
  readonly id: string;
  readonly user_id: string;
  readonly email?: string;
  readonly title: string;
  readonly status: 'complete' | 'failed';
  readonly summary?: string;
  readonly story_count: number;
  readonly created_at?: string;
}

/** A stored SQLite time as RFC 3339, or undefined when it does not parse. */
function timestamp(stored: string | null): string | undefined {
  if (!stored) return undefined;
  const ms = Date.parse(`${stored.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** The sections a stored briefing has. */
function sectionsOf(stored: string): Category[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((k): k is Category => CATEGORIES.includes(k as Category))
      : [];
  } catch {
    return [];
  }
}

/**
 * The API's view of a briefing: its stories with what `articles` says of
 * them, and whether the person read each (`read`).
 */
export function briefingResource(
  b: Readonly<StoredBriefing>,
  articles: ReadonlyMap<number, Article> = new Map(),
  read: ReadonlySet<number> = new Set(),
): BriefingResource {
  const created = timestamp(b.created_at);
  return {
    id: String(b.id),
    title: b.title,
    slot: b.slot,
    local_date: b.local_date,
    frequency: b.frequency,
    period_start: b.period_start,
    status: b.status === 'complete' ? 'complete' : 'failed',
    ...(b.summary ? { summary: b.summary } : {}),
    ...(b.error ? { error: b.error } : {}),
    sections: sectionsOf(b.sections),
    stories: parseBriefedStories(b.stories).map(({ id, category }) => {
      const a = articles.get(id);
      return {
        article_id: String(id),
        category,
        ...(a?.title ? { title: a.title } : {}),
        ...(a ? { url: a.url, source: a.source || hostOf(a.url) } : {}),
        read: read.has(id),
      };
    }),
    ...(b.model ? { model: b.model } : {}),
    ...(b.tokens !== null ? { tokens: b.tokens } : {}),
    ...(b.seconds !== null ? { seconds: b.seconds } : {}),
    ...(created ? { created_at: created } : {}),
  };
}

/** The operator's view of a briefing. */
export function briefingAuditResource(
  b: Readonly<StoredBriefing>,
  email?: string,
): BriefingAuditResource {
  const created = timestamp(b.created_at);
  return {
    id: String(b.id),
    user_id: String(b.user_id),
    ...(email ? { email } : {}),
    title: b.title,
    status: b.status === 'complete' ? 'complete' : 'failed',
    ...(b.summary ? { summary: b.summary } : {}),
    story_count: parseBriefedStories(b.stories).length,
    ...(created ? { created_at: created } : {}),
  };
}

/** Where a page of briefings starts and how long it is. */
export interface BriefingQuery {
  /** Only briefings with a smaller id: the last one already shown. */
  readonly before?: number;
  readonly limit: number;
}

/** A checked list query, or what was wrong with it. */
export type BriefingQueryInput =
  | { readonly ok: true; readonly query: BriefingQuery }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check the query of a list of briefings: `cursor` one this API issued and
 * `limit` a whole number from 1 to the page maximum. Other parameters are
 * refused.
 */
export function parseBriefingQuery(
  params: URLSearchParams,
): BriefingQueryInput {
  const errors: string[] = [];
  for (const key of new Set(params.keys())) {
    if (key !== 'cursor' && key !== 'limit') {
      errors.push(`${key}: not a parameter of this list.`);
    }
  }
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
    : { ok: true, query: { before, limit } };
}
