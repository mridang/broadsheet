import { readdir } from 'node:fs/promises';
import path from 'node:path';

const files = await readdir(path.join(process.cwd(), 'migrations'));

/**
 * Every migration file, in order: what a database looks like once all of them
 * have been applied, which is what the schema file in `src/lib/db` mirrors.
 */
export const APP_MIGRATIONS: readonly string[] = files
  .filter((file) => file.endsWith('.sql'))
  .toSorted((a, b) => a.localeCompare(b));
