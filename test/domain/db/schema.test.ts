import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import * as schema from '@/domain/db/schema';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

/** The column names SQLite reports for a table, sorted. */
function columnsOf(raw: DatabaseSync, table: string): readonly string[] {
  return raw
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row['name']))
    .toSorted();
}

/** The names of the indexes SQLite reports for a table. */
function indexesOf(raw: DatabaseSync, table: string): readonly string[] {
  return raw
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((row) => String(row['name']));
}

/** The drizzle tables of the schema file, by their SQL name. */
const tables = new Map(
  Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map((table) => [getTableConfig(table).name, table] as const),
);

describe('the schema file and the migrations', () => {
  const { raw } = sqliteD1(...APP_MIGRATIONS);

  it('finds the tables of the schema', () => {
    expect(tables.size).toBeGreaterThan(0);
  });

  it.each([...tables.keys()])(
    'declares the table %s with the columns and indexes the migrations create',
    (name) => {
      const table = tables.get(name);
      expect(table).toBeDefined();
      const config = getTableConfig(table!);
      expect(columnsOf(raw, name)).toEqual(
        config.columns.map((column) => column.name).toSorted(),
      );
      // Every index the schema names exists (the database may carry more, such
      // as the legacy unique constraint on recipes.drive_file_id).
      const present = indexesOf(raw, name);
      config.indexes.forEach((index) =>
        expect(present).toContain(index.config.name),
      );
    },
  );
});
