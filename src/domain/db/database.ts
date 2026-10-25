/**
 * @packageDocumentation
 *
 * The app's Drizzle client, bound to its own schema. The generic client
 * builder lives in `lib/core/db`; here the app supplies its schema, so the
 * platform layer never imports the app's tables. Request-scoped code calls
 * {@link getDatabase}; code handed a raw binding (the cron handler, tests)
 * calls {@link databaseFrom}.
 */

import {
  createDatabase,
  type Database as GenericDatabase,
} from '@/lib/core/db/client';
import { getDB } from '@/lib/core/runtime';
import * as schema from '@/domain/db/schema';

/** A Drizzle client typed against this app's schema. */
export type Database = GenericDatabase<typeof schema>;

/** Build the app's typed client from a raw D1 binding. */
export function databaseFrom(d1: D1Database): Database {
  return createDatabase(d1, schema);
}

/** The app's typed client bound to the current request's D1 binding. */
export function getDatabase(): Database {
  return databaseFrom(getDB());
}
