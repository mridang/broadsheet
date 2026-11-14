/**
 * @packageDocumentation
 *
 * Rate limiting with fixed windows, kept in D1 so every Worker instance sees the
 * same counts. A {@link RateLimit} says how many hits a window allows; `rateLimit`
 * records one hit for a subject (a user, a client, an address) and answers
 * whether it may go ahead. The counting is one atomic SQL statement, so two
 * requests arriving together cannot both read the same count.
 *
 * Fixed windows are coarse (a burst can straddle two windows and briefly see
 * twice the limit) but they are cheap and predictable, which is what protects a
 * small app from a runaway client.
 */

/** How many hits a named thing may take in a window of a given length. */
export interface RateLimit {
  /** What is limited, e.g. `mcp-tool-call`; part of the counter's key. */
  readonly name: string;
  /** The most hits one subject may make in a window. */
  readonly limit: number;
  /** How long a window lasts, in seconds. */
  readonly windowSeconds: number;
}

/** Where the counters live. Real use is {@link D1RateLimitStore}; tests supply their own. */
export interface RateLimitStore {
  /**
   * Record a hit on `key` at `now` (seconds). A window that opened at or before
   * `now - windowSeconds` has run out and starts again at one.
   */
  hit(
    key: string,
    now: number,
    windowSeconds: number,
  ): Promise<Readonly<{ count: number; windowStart: number }>>;
  /** Forget counters whose window opened before `before` (seconds). */
  purge(before: number): Promise<void>;
}

/** The answer to "may this go ahead?". */
export type RateDecision =
  | Readonly<{ allowed: true; remaining: number }>
  | Readonly<{ allowed: false; retryAfterSeconds: number }>;

/** The statement that counts a hit; one round trip, atomic. */
const HIT_SQL = `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN rate_limits.window_start <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
  window_start = CASE WHEN rate_limits.window_start <= ?3 THEN ?2 ELSE rate_limits.window_start END
RETURNING count, window_start`;

/** Whether a value is a row shaped like `{ count, window_start }`. */
function isHitRow(
  value: unknown,
): value is Readonly<{ count: number; window_start: number }> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'count' in value &&
    typeof value.count === 'number' &&
    'window_start' in value &&
    typeof value.window_start === 'number'
  );
}

/** A store backed by a D1 database's `rate_limits` table. */
/** The {@link RateLimitStore} backed by a D1 binding. */
export class D1RateLimitStore implements RateLimitStore {
  readonly #d1: D1Database;

  constructor(d1: D1Database) {
    this.#d1 = d1;
  }

  async hit(
    key: string,
    now: number,
    windowSeconds: number,
  ): Promise<{ readonly count: number; readonly windowStart: number }> {
    const row = await this.#d1
      .prepare(HIT_SQL)
      .bind(key, now, now - windowSeconds)
      .first();
    if (!isHitRow(row)) {
      throw new Error('rate limit counter did not answer');
    }
    return { count: row.count, windowStart: row.window_start };
  }

  async purge(before: number): Promise<void> {
    await this.#d1
      .prepare('DELETE FROM rate_limits WHERE window_start < ?1')
      .bind(before)
      .run();
  }
}

/**
 * Record one hit by `subject` against `limit` and say whether it may go ahead.
 * `now` is in seconds and is a parameter so tests need no clock.
 */
export async function rateLimit(
  store: RateLimitStore,
  limit: RateLimit,
  subject: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<RateDecision> {
  const { count, windowStart } = await store.hit(
    `${limit.name}:${subject}`,
    now,
    limit.windowSeconds,
  );
  return count <= limit.limit
    ? { allowed: true, remaining: limit.limit - count }
    : {
        allowed: false,
        retryAfterSeconds: Math.max(1, windowStart + limit.windowSeconds - now),
      };
}

/**
 * Sweep away counters that have been idle for at least `idleSeconds`. Cheap, so
 * callers run it now and then (a small fraction of requests) rather than on a
 * schedule.
 */
export async function purgeRateLimits(
  store: RateLimitStore,
  idleSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  await store.purge(now - idleSeconds);
}
