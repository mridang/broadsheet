/**
 * @packageDocumentation
 *
 * A large OPML import, run in the background by the `FeedImportRun` Workflow
 * a chunk of feeds at a time, with its progress kept in `feed_imports` so the
 * person can watch it at `/api/feeds/imports/:id`.
 */

import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';

import type { OpmlFeed } from '@/domain/api/opml';
import type { Database } from '@/domain/db/database';
import { feed_imports } from '@/domain/db/schema';
import { importFeeds } from '@/domain/feed-import';
import { Repository } from '@/domain/repository';

/** Imports of more feeds than this run in a Workflow, in chunks of this many. */
export const IMPORT_CHUNK = 50;

/** Where an import is. */
export type ImportStatus = 'running' | 'complete' | 'failed';

/** An import's progress and what it did so far. */
export interface ImportRun {
  readonly id: string;
  readonly status: ImportStatus;
  /** Entries in the file. */
  readonly total: number;
  /** Entries looked at so far. */
  readonly processed: number;
  readonly added: number;
  readonly skipped: number;
  readonly sections_added: number;
  /** Entries that could not be followed, with why. */
  readonly rejected: readonly {
    readonly url: string;
    readonly reason: string;
  }[];
}

/** A stored `rejected` list, or none. */
function rejectedOf(stored: string): ImportRun['rejected'] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as ImportRun['rejected']) : [];
  } catch {
    return [];
  }
}

/** The stored imports. */
export class FeedImportRuns {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Record a new import of `total` entries for `uid`, returning its id. */
  async start(uid: number, total: number): Promise<ImportRun> {
    const id = crypto.randomUUID();
    await this.#db.insert(feed_imports).values({ id, user_id: uid, total });
    return {
      id,
      status: 'running',
      total,
      processed: 0,
      added: 0,
      skipped: 0,
      sections_added: 0,
      rejected: [],
    };
  }

  /** One of `uid`'s imports, or none. */
  async find(uid: number, id: string): Promise<ImportRun | undefined> {
    const [row] = await this.#db
      .select()
      .from(feed_imports)
      .where(and(eq(feed_imports.id, id), eq(feed_imports.user_id, uid)))
      .limit(1);
    return row
      ? {
          id: row.id,
          status: row.status as ImportStatus,
          total: row.total,
          processed: row.processed,
          added: row.added,
          skipped: row.skipped,
          sections_added: row.sections_added,
          rejected: rejectedOf(row.rejected),
        }
      : undefined;
  }

  /**
   * Follow one chunk of an import's entries and add what it did to the
   * import, returning the feeds it newly followed.
   */
  async importChunk(
    id: string,
    uid: number,
    entries: readonly OpmlFeed[],
  ): Promise<{ readonly id: number; readonly url: string }[]> {
    const summary = await importFeeds(new Repository(this.#db), uid, entries);
    const [row] = await this.#db
      .select({ rejected: feed_imports.rejected })
      .from(feed_imports)
      .where(eq(feed_imports.id, id))
      .limit(1);
    await this.#db
      .update(feed_imports)
      .set({
        processed: sql`${feed_imports.processed} + ${entries.length}`,
        added: sql`${feed_imports.added} + ${summary.added}`,
        skipped: sql`${feed_imports.skipped} + ${summary.skipped}`,
        sections_added: sql`${feed_imports.sections_added} + ${summary.sections_added}`,
        rejected: JSON.stringify([
          ...rejectedOf(row?.rejected ?? '[]'),
          ...summary.rejected,
        ]),
      })
      .where(eq(feed_imports.id, id));
    return summary.feeds.map((feed) => ({ id: feed.source_id, url: feed.url }));
  }

  /** Mark an import done, or failed. */
  async finish(id: string, status: Exclude<ImportStatus, 'running'>) {
    await this.#db
      .update(feed_imports)
      .set({ status, finished_at: sql`(datetime('now'))` })
      .where(eq(feed_imports.id, id));
  }

  /** Delete the imports that finished before `before`, returning how many. */
  async purgeFinished(before: Date): Promise<number> {
    const stamp = before.toISOString().slice(0, 19).replace('T', ' ');
    const gone = await this.#db
      .delete(feed_imports)
      .where(
        and(
          isNotNull(feed_imports.finished_at),
          lt(feed_imports.finished_at, stamp),
        ),
      )
      .returning({ id: feed_imports.id });
    return gone.length;
  }
}
