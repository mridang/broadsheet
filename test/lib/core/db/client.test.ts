import { is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from '@jest/globals';

import { createDatabase } from '@/lib/core/db/client';
import * as schema from '@/domain/db/schema';
import { APP_MIGRATIONS } from './migrations';
import { sqliteD1 } from './sqlite-d1';

describe('createDatabase', () => {
  it('wraps a D1 binding in a client that keeps the binding as $client', () => {
    const { d1 } = sqliteD1();
    expect(createDatabase(d1, schema).$client).toBe(d1);
  });

  it('runs typed queries against every table of the schema', async () => {
    const { d1 } = sqliteD1(...APP_MIGRATIONS);
    const db = createDatabase(d1, schema);
    const tables = Object.values(schema).filter((value) =>
      is(value, SQLiteTable),
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(Array.isArray(await db.select().from(table))).toBe(true);
    }
  });
});
