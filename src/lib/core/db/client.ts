import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

/**
 * A Drizzle client bound to a D1 database, typed against the schema `S` the
 * caller supplies. Generic so this platform helper never needs to know the
 * app's own tables.
 */
export type Database<
  S extends Record<string, unknown> = Record<string, unknown>,
> = DrizzleD1Database<S> & { $client: D1Database };

/**
 * Wrap a raw D1 binding in a typed Drizzle client for the given schema. The
 * schema is passed in — the app binds its own (see `domain/db`) — so this
 * module stays free of any one app's tables.
 *
 * @public
 */
export function createDatabase<S extends Record<string, unknown>>(
  d1: D1Database,
  schema: S,
): Database<S> {
  return drizzle(d1, { schema }) as Database<S>;
}
