import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import * as schema from '@/domain/db/schema';

/** A Drizzle client bound to a D1 database, typed against {@link schema}. */
export type Database = DrizzleD1Database<typeof schema> & {
  $client: D1Database;
};

/**
 * Wrap a raw D1 binding in a typed Drizzle client. Code that has a request
 * context gets one from `getDatabase()`; code that is handed a binding (a
 * Workflow, a test) calls this directly.
 *
 * @public
 */
export function createDatabase(d1: D1Database): Database {
  return drizzle(d1, { schema });
}
