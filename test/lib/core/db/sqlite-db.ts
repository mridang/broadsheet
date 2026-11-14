import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import type { Database } from '@/domain/db/client';
import {
  users,
  oauthClients,
  oauthAssertions,
  oauthGrants,
  oauthCodes,
  oauthTokens,
} from '@/domain/db/schema';

/** The method Drizzle asks the driver to run a statement with. */
type Method = 'run' | 'all' | 'values' | 'get';

/** A real SQLite database (in memory) with the given migrations applied, driven through Drizzle. */
export interface SqliteDatabase {
  /** The Drizzle client, typed as the app's `Database` (its `$client` is not a D1 binding). */
  readonly db: Database;
  /** The raw connection, for seeding and inspecting rows. */
  readonly raw: DatabaseSync;
}

/**
 * Open an in-memory SQLite database with the named migration files from
 * `migrations/` applied in order, and a Drizzle client over it. Results are
 * shaped as D1's are (`{ meta: { changes } }` for writes), and a batch runs as
 * one transaction that rolls back if any statement fails, as D1's does. That is
 * enough to test repositories against the real SQL rather than a stub.
 */
const schema = {
  users,
  oauthClients,
  oauthAssertions,
  oauthGrants,
  oauthCodes,
  oauthTokens,
};

export function sqliteDatabase(
  ...migrations: readonly string[]
): SqliteDatabase {
  const raw = new DatabaseSync(':memory:');
  migrations.forEach((file) =>
    raw.exec(
      readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8'),
    ),
  );
  const exec = (sql: string, params: readonly unknown[], method: Method) => {
    const statement = raw.prepare(sql);
    const values = params as SQLInputValue[];
    if (method === 'run') {
      const outcome = statement.run(...values);
      return { rows: [], meta: { changes: Number(outcome.changes) } };
    }
    statement.setReturnArrays(true);
    const rows = statement.all(...values);
    // For `get`, Drizzle wants the one row (itself an array), not a list.
    return {
      rows: (method === 'get' ? rows[0] : rows) as unknown as unknown[],
    };
  };
  const client = drizzle(
    async (sql, params, method) => exec(sql, params, method),
    async (batch) => {
      raw.exec('BEGIN');
      try {
        const results = batch.map((q) => exec(q.sql, q.params, q.method));
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    { schema },
  );
  return { db: client as unknown as Database, raw };
}
