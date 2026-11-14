/**
 * @packageDocumentation
 *
 * What more than one tool is built from: the argument fragments they share, the
 * limits they all respect, paging over a filtered query, and the shapes a feed,
 * a section tree and a shared story take in an answer.
 *
 * These sit beside the tools rather than inside one of them because they are
 * the parts two tools must agree on: an assistant that learns what an id or a
 * date means from one tool should not meet a different rule in the next.
 */

import { articleResource } from '@/domain/api/article-resource';
import { type Database } from '@/domain/db/database';
import { isIssueDate } from '@/domain/issues';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { Repository, type Section } from '@/domain/repository';
import { refreshSource } from '@/domain/scraping/index';
import { type SharedStory } from '@/domain/shares';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** The production way to fetch a newly followed feed. */
export function refresher(
  db: Database,
  env: CloudflareEnv,
  background: (work: Promise<unknown>) => void,
): ToolContext['refresh'] {
  return (source) =>
    background(refreshSource(db, env, source).catch(() => undefined));
}

/** A positive whole-number id. */
export const id = (what: string) =>
  z.number().int().positive().describe(`The ${what}'s id.`);

/** The checked body of a REST input parser, or a failure naming its errors. */
export function checked<T>(
  result:
    | ({ readonly ok: true } & T)
    | { readonly ok: false; readonly errors: readonly string[] },
): T {
  if (!result.ok) throw new ToolFailureError(result.errors.join(' '));
  return result;
}

/** The most stories `search_articles` returns at once. */
export const MAX_SEARCH = 50;

/** A calendar day written YYYY-MM-DD. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIssueDate, 'not a calendar date');

/** How many rows one search fetches while filtering. */
export const BATCH = 100;

/** The most batches one search reads while filtering. */
export const MAX_BATCHES = 10;

/**
 * Page through `fetch` (which returns one more row than asked for) until
 * `limit` rows pass `keep` or the rows run out. `next` is the id to continue
 * from when more may follow.
 */
export async function collect<T extends { readonly id: number }>(
  fetch: (before: number | undefined, limit: number) => Promise<T[]>,
  keep: (row: T) => boolean,
  limit: number,
  start?: number,
): Promise<{ readonly items: T[]; readonly next?: number }> {
  const items: T[] = [];
  let before = start;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await fetch(before, BATCH);
    const page = rows.slice(0, BATCH);
    for (const row of page) {
      if (keep(row)) items.push(row);
      before = row.id;
      if (items.length === limit) {
        const more = row !== page.at(-1) || rows.length > BATCH;
        return more ? { items, next: row.id } : { items };
      }
    }
    if (rows.length <= BATCH) return { items };
  }
  return before === undefined ? { items } : { items, next: before };
}

/** A section and every section nested under it, by id. */
export function sectionTree(
  sections: readonly Section[],
  root: number,
): Set<number> {
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of sections) {
      if (s.parent_id !== null && tree.has(s.parent_id) && !tree.has(s.id)) {
        tree.add(s.id);
        grew = true;
      }
    }
  }
  return tree;
}

/**
 * The subscription ids a story listing is narrowed to (a feed, several, a
 * section), or undefined for every feed. Each named feed and section must be
 * the caller's.
 */
export async function feedScope(
  repo: Repository,
  uid: number,
  scope: {
    readonly feed_id?: number;
    readonly feed_ids?: readonly number[];
    readonly section_id?: number;
  },
): Promise<number[] | undefined> {
  if (
    scope.feed_id === undefined &&
    scope.feed_ids === undefined &&
    scope.section_id === undefined
  ) {
    return undefined;
  }
  const [feeds, sections] = await Promise.all([
    repo.listFeeds(uid),
    repo.listSections(uid),
  ]);
  const mine = new Set(feeds.map((f) => f.id));
  const named = [
    ...(scope.feed_id === undefined ? [] : [scope.feed_id]),
    ...(scope.feed_ids ?? []),
  ];
  if (named.some((f) => !mine.has(f))) {
    throw new ToolFailureError('There is no such feed.');
  }
  let ids = named.length > 0 ? named : [...mine];
  if (scope.section_id !== undefined) {
    if (!sections.some((s) => s.id === scope.section_id)) {
      throw new ToolFailureError('There is no such section.');
    }
    const tree = sectionTree(sections, scope.section_id);
    const inTree = new Set(
      feeds
        .filter((f) => f.section_id !== null && tree.has(f.section_id))
        .map((f) => f.id),
    );
    ids = ids.filter((f) => inTree.has(f));
  }
  return ids;
}

/** A shared story as the tools show it: never the sharer's email. */
export function shareResource(share: SharedStory): Record<string, unknown> {
  return {
    share_id: String(share.id),
    article: articleResource(share.article),
    ...(share.comments ? { comments: share.comments } : {}),
    ...(share.shared_at ? { shared_at: share.shared_at } : {}),
    sharer: {
      id: String(share.sharer.id),
      ...(share.sharer.name ? { name: share.sharer.name } : {}),
    },
  };
}

/** The classifier kinds `train_classifier` takes lists of. */
export const TRAINABLE = ['title', 'author', 'tag', 'text'] as const;

/** The longest note or highlight on a save. */
export const MAX_NOTE = 5000;

/** The most highlights on one save. */
export const MAX_HIGHLIGHTS = 50;

/** The most stories `mark_read` marks at once. */
export const MAX_MARK = 500;

/** An object without its undefined members, for the REST parsers. */
export function dropUndefined(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
}
