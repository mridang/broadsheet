import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every migration file, in order: what a database looks like once all of them
 * have been applied, which is what the schema file in `src/lib/db` mirrors.
 */
// eslint-disable-next-line n/no-sync -- sync is fine in a script or bootstrap
export const APP_MIGRATIONS: readonly string[] = readdirSync(
  path.join(process.cwd(), 'migrations'),
)
  .filter((file) => file.endsWith('.sql'))
  .toSorted((a, b) => a.localeCompare(b));
