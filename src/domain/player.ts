/**
 * @packageDocumentation
 *
 * Data access for listening, as NewsBlur's media player keeps it: one row per
 * person with their playback rate, the story being read and how far in, and
 * the stories queued next and already heard.
 */

import { eq, sql } from 'drizzle-orm';

import { type Database } from '@/domain/db/client';
import { players } from '@/domain/db/schema';

/** Where a person is in their listening. */
export interface PlayerState {
  /** How fast the voice reads, 1 being normal. */
  readonly rate: number;
  /** The story being read and how far in (a character offset), if any. */
  readonly current: {
    readonly article_id: number;
    readonly position: number;
  } | null;
  /** The stories to read next, in order. */
  readonly queue: readonly number[];
  /** The stories already heard, newest first. */
  readonly history: readonly number[];
}

/** The state of someone who has never listened. */
export const EMPTY_PLAYER: PlayerState = {
  rate: 1,
  current: null,
  queue: [],
  history: [],
};

/** A stored JSON array of ids, keeping only the whole numbers in it. */
function idsOf(stored: string): number[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is number => Number.isInteger(v) && v > 0)
      : [];
  } catch {
    return [];
  }
}

/** Reads and writes each person's player. */
export class PlayerRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** The person's player, or the empty one when they never listened. */
  async get(userId: number): Promise<PlayerState> {
    const [row] = await this.#db
      .select()
      .from(players)
      .where(eq(players.user_id, userId))
      .limit(1);
    if (!row) return EMPTY_PLAYER;
    return {
      rate: row.rate,
      current:
        row.current_article_id === null
          ? null
          : { article_id: row.current_article_id, position: row.position },
      queue: idsOf(row.queue),
      history: idsOf(row.history),
    };
  }

  /** Replace the person's player. */
  async put(userId: number, state: PlayerState): Promise<void> {
    const row = {
      rate: state.rate,
      current_article_id: state.current?.article_id ?? null,
      position: state.current?.position ?? 0,
      queue: JSON.stringify(state.queue),
      history: JSON.stringify(state.history),
      updated_at: sql`(datetime('now'))`,
    };
    await this.#db
      .insert(players)
      .values({ user_id: userId, ...row })
      .onConflictDoUpdate({ target: players.user_id, set: row });
  }

  /** Forget the person's player. True when there was one. */
  async clear(userId: number): Promise<boolean> {
    const removed = await this.#db
      .delete(players)
      .where(eq(players.user_id, userId))
      .returning({ id: players.user_id });
    return removed.length > 0;
  }
}
