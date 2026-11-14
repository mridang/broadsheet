import type { DatabaseSync } from 'node:sqlite';
import { expect } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
import { APP_MIGRATIONS } from './migrations';
import { sqliteD1 } from './sqlite-d1';

/** A migrated database that remembers the statements sent to it. */
export interface RecordedDatabase {
  readonly db: Database;
  readonly raw: DatabaseSync;
  /** Every statement text prepared so far, in order. */
  readonly statements: string[];
  /** The statements prepared so far that contain `text`. */
  sent(text: string): string[];
  /** The query plan of the last statement that contains `text`. */
  planOf(text: string): string;
}

/**
 * A database with the app's migrations applied whose binding records the
 * statements a real repository method sends, so a test can run
 * `EXPLAIN QUERY PLAN` on the code as written and not on a copy of it. The
 * plan does not depend on row counts when there are no statistics, so an empty
 * database shows the access path.
 */
export function recordedDatabase(): RecordedDatabase {
  const { d1, raw } = sqliteD1(...APP_MIGRATIONS);
  const statements: string[] = [];
  const recording = {
    ...d1,
    prepare: (text: string) => {
      statements.push(text);
      return d1.prepare(text);
    },
  } as unknown as D1Database;
  const sent = (text: string) => statements.filter((s) => s.includes(text));
  return {
    db: databaseFrom(recording),
    raw,
    statements,
    sent,
    planOf: (text) => {
      const found = sent(text).at(-1);
      if (found === undefined) throw new Error(`no statement has: ${text}`);
      return raw
        .prepare(`EXPLAIN QUERY PLAN ${found}`)
        .all()
        .map((row) => String(row['detail']))
        .join('\n');
    },
  };
}

/**
 * The three things a hot query must show: each named index is used, no table
 * is scanned (a covering index scan of the named index is allowed when `scans`
 * lists it) and no temporary b-tree sorts or groups.
 */
export function expectIndexed(
  plan: string,
  indexes: readonly string[],
  {
    scans = [],
    sorts = false,
  }: { scans?: readonly string[]; sorts?: boolean } = {},
): void {
  indexes.forEach((index) => expect(plan).toContain(index));
  const scanned = plan
    .split('\n')
    .filter((line) => /^\s*SCAN /.test(line))
    .filter((line) => !scans.some((allowed) => line.includes(allowed)));
  expect(scanned).toEqual([]);
  if (!sorts) expect(plan).not.toMatch(/TEMP B-TREE/);
}
