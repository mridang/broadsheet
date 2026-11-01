/**
 * @packageDocumentation
 *
 * Issues on the wire: the representation `/api/editions/self/issues/{date}`
 * sends for one day's paper, the short form the list of issues shows, and
 * checking the body that asks for an issue to be laid out again.
 */

import type { Category } from '@/domain/briefing';
import { isIssueDate, type Issue } from '@/domain/issues';
import type { IssueListing } from '@/domain/repository';
import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor } from '@/lib/core/api';
import type { Tier } from '@/domain/render/tiers';

/** One story as the issue prints it. */
export interface IssueStoryResource {
  readonly article_id: string;
  readonly tier: Tier;
  readonly also_covered_by: readonly string[];
  /** The other copies of the story, folded into this one. */
  readonly covered_by: readonly IssueSiblingResource[];
}

/** Another source's copy of a story. */
export interface IssueSiblingResource {
  readonly article_id: string;
  readonly source: string;
  readonly url: string;
  /** 'title' when the headlines match, 'related' when only the meaning does. */
  readonly match: 'title' | 'related';
}

/** A story the editor's note covers, and why it was picked. */
export interface BriefedStoryResource {
  readonly article_id: string;
  readonly category: Category;
}

/** One feed's desk in the issue. */
export interface IssueDeskResource {
  readonly feed_id: string;
  readonly title: string;
  readonly url: string;
  readonly stories: readonly IssueStoryResource[];
}

/** A section of the issue; the unfiled desks come in one with no name. */
export interface IssueSectionResource {
  readonly name?: string;
  readonly desks: readonly IssueDeskResource[];
}

/** One day's paper. Absent members are unknown, never null. */
export interface IssueResource {
  readonly date: string;
  readonly briefing?: string;
  readonly briefing_stories: readonly BriefedStoryResource[];
  readonly sections: readonly IssueSectionResource[];
  readonly created_at?: string;
}

/** One issue in the list of a person's issues. */
export interface IssueSummaryResource {
  readonly date: string;
  readonly briefing?: string;
  readonly created_at?: string;
}

/** A stored SQLite time as RFC 3339, or undefined when it does not parse. */
function timestamp(stored: string | null): string | undefined {
  if (!stored) return undefined;
  const ms = Date.parse(`${stored.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** The API's view of an issue. */
export function issueResource(issue: Readonly<Issue>): IssueResource {
  const created = timestamp(issue.created_at);
  return {
    date: issue.date,
    ...(issue.briefing ? { briefing: issue.briefing } : {}),
    briefing_stories: issue.briefing_stories.map((s) => ({
      article_id: String(s.id),
      category: s.category,
    })),
    sections: issue.layout.groups.map((group) => ({
      ...(group.name ? { name: group.name } : {}),
      desks: group.desks.map((desk) => ({
        feed_id: String(desk.feed_id),
        title: desk.title,
        url: desk.url,
        stories: desk.stories.map((story) => ({
          article_id: String(story.id),
          tier: story.tier,
          also_covered_by: story.also,
          covered_by: (story.siblings ?? []).map((s) => ({
            article_id: String(s.id),
            source: s.source,
            url: s.url,
            match: s.tier,
          })),
        })),
      })),
    })),
    ...(created ? { created_at: created } : {}),
  };
}

/** The API's view of one issue in a list. */
export function issueSummaryResource(
  issue: Readonly<IssueListing>,
): IssueSummaryResource {
  const created = timestamp(issue.created_at);
  return {
    date: issue.date,
    ...(issue.briefing ? { briefing: issue.briefing } : {}),
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked request to lay out an issue, or what was wrong with it. */
export type IssueRequestInput =
  | { readonly ok: true; readonly date: string }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check the body of `POST /api/editions/self/issues`: `date`, a calendar date
 * written YYYY-MM-DD, and nothing else.
 */
export function parseIssueRequest(
  body: Readonly<Record<string, unknown>>,
): IssueRequestInput {
  const errors = Object.keys(body)
    .filter((k) => k !== 'date')
    .map((k) => `${k}: not a member of an issue request.`);
  const date = body['date'];
  if (typeof date !== 'string' || !isIssueDate(date)) {
    errors.push('date: must be a date written YYYY-MM-DD.');
  }
  return errors.length || typeof date !== 'string'
    ? { ok: false, errors }
    : { ok: true, date };
}

/** Where a page of the list of issues starts and how long it is. */
export interface IssueQuery {
  /** Only issues before this date: the last one already shown. */
  readonly before?: string;
  readonly limit: number;
}

/** A checked list query, or what was wrong with it. */
export type IssueQueryInput =
  | { readonly ok: true; readonly query: IssueQuery }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check the query of `GET /api/editions/self/issues`: `cursor` one this API
 * issued and `limit` a whole number from 1 to the page maximum. Other
 * parameters are refused.
 */
export function parseIssueQuery(params: URLSearchParams): IssueQueryInput {
  const errors: string[] = [];
  for (const key of new Set(params.keys())) {
    if (key !== 'cursor' && key !== 'limit') {
      errors.push(`${key}: not a parameter of this list.`);
    }
  }
  let before: string | undefined;
  const cursor = params.get('cursor');
  if (cursor !== null) {
    before = decodeCursor(cursor)?.key;
    if (before === undefined || !isIssueDate(before)) {
      errors.push('cursor: not a cursor of this list.');
    }
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
