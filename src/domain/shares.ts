/**
 * @packageDocumentation
 *
 * Shared stories: a person shares a story from their feeds with an optional
 * comment, and anyone can list shares, everyone's or chosen people's. A share
 * shows the sharer's id and name, never their email.
 */

import { and, desc, eq, getTableColumns, inArray, lt } from 'drizzle-orm';

import type { Database } from '@/domain/db/database';
import { articles, shares, users } from '@/domain/db/schema';
import type { ArticleSummary } from '@/domain/repository';

/** A shared story. */
export interface SharedStory {
  readonly id: number;
  readonly article: ArticleSummary;
  readonly comments: string | null;
  readonly shared_at: string | null;
  readonly sharer: { readonly id: number; readonly name: string | null };
}

/** Where a page of shares starts, how long it is, and whose. */
export interface ShareQuery {
  /** Only these people's shares; every share when left out. */
  readonly userIds?: readonly number[];
  /** Only shares with a smaller id: the last one already shown. */
  readonly before?: number;
  readonly limit: number;
}

/** Every column of an article but its text. */
const summaryColumns = Object.fromEntries(
  Object.entries(getTableColumns(articles)).filter(
    ([name]) => name !== 'body_text',
  ),
) as Omit<ReturnType<typeof getTableColumns<typeof articles>>, 'body_text'>;

/** Shares over an injected Drizzle client. */
export class ShareRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Share a story, replacing the comment of an earlier share. The caller
   * checks the article is one the person may see.
   */
  async share(
    userId: number,
    articleId: number,
    comments: string | null,
  ): Promise<{ readonly story: SharedStory; readonly created: boolean }> {
    const [before] = await this.#db
      .select({ id: shares.id })
      .from(shares)
      .where(and(eq(shares.user_id, userId), eq(shares.article_id, articleId)))
      .limit(1);
    await this.#db
      .insert(shares)
      .values({ user_id: userId, article_id: articleId, comments })
      .onConflictDoUpdate({
        target: [shares.user_id, shares.article_id],
        set: { comments },
      });
    const [story] = await this.#shared().where(
      and(eq(shares.user_id, userId), eq(shares.article_id, articleId)),
    );
    return { story: this.#story(story!), created: !before };
  }

  /** Stop sharing a story. True when the person had shared it. */
  async unshare(userId: number, articleId: number): Promise<boolean> {
    const removed = await this.#db
      .delete(shares)
      .where(and(eq(shares.user_id, userId), eq(shares.article_id, articleId)))
      .returning({ id: shares.id });
    return removed.length > 0;
  }

  /**
   * Shares, newest first. Asks for one more than `limit`, so the caller can
   * tell whether another page follows.
   */
  async list({ userIds, before, limit }: ShareQuery): Promise<SharedStory[]> {
    const rows = await this.#shared()
      .where(
        and(
          userIds ? inArray(shares.user_id, [...userIds]) : undefined,
          before === undefined ? undefined : lt(shares.id, before),
        ),
      )
      .orderBy(desc(shares.id))
      .limit(limit + 1);
    return rows.map((row) => this.#story(row));
  }

  /** Shares joined to their articles and sharers. */
  #shared() {
    return this.#db
      .select({
        id: shares.id,
        article: summaryColumns,
        comments: shares.comments,
        shared_at: shares.created_at,
        sharer_id: users.id,
        sharer_name: users.name,
      })
      .from(shares)
      .innerJoin(articles, eq(shares.article_id, articles.id))
      .innerJoin(users, eq(shares.user_id, users.id));
  }

  #story(row: {
    id: number;
    article: ArticleSummary;
    comments: string | null;
    shared_at: string | null;
    sharer_id: number;
    sharer_name: string | null;
  }): SharedStory {
    return {
      id: row.id,
      article: row.article,
      comments: row.comments,
      shared_at: row.shared_at,
      sharer: { id: row.sharer_id, name: row.sharer_name },
    };
  }
}
