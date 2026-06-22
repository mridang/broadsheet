import { drizzle } from 'drizzle-orm/d1';

import * as schema from './schema';

/** A Drizzle client bound to a D1 database, typed against {@link schema}. */
export type Database = ReturnType<typeof createDatabase>;

/**
 * Wrap a raw D1 binding in a typed Drizzle client.
 *
 * @public
 */
export function createDatabase(d1: D1Database) {
  return drizzle(d1, { schema });
}
