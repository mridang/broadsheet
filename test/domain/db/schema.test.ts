import { is } from 'drizzle-orm';
import { SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import {
  users,
  sources,
  sections,
  subscriptions,
  subscription_sections,
  articles,
  classifiers,
  saves,
  reads,
  clusters,
  issues,
  editions,
  edition_issues,
  conversations,
  messages,
  answers,
  ai_usage,
  oauth_clients,
  oauth_grants,
  oauth_codes,
  oauth_tokens,
  push_subscriptions,
  webhooks,
  feed_tokens,
  feed_notifications,
  notification_deliveries,
  story_emails,
  savedSearches,
  fetchHistory,
  notification_rules,
  user_activity,
  preferences,
  shares,
  players,
  rivers,
  briefings,
  prompt_scores,
  feed_recommendations,
  feed_imports,
} from '@/domain/db/schema';

const schema = {
  users,
  sources,
  sections,
  subscriptions,
  subscription_sections,
  articles,
  classifiers,
  saves,
  reads,
  clusters,
  issues,
  editions,
  edition_issues,
  conversations,
  messages,
  answers,
  ai_usage,
  oauth_clients,
  oauth_grants,
  oauth_codes,
  oauth_tokens,
  push_subscriptions,
  webhooks,
  feed_tokens,
  feed_notifications,
  notification_deliveries,
  story_emails,
  savedSearches,
  fetchHistory,
  notification_rules,
  user_activity,
  preferences,
  shares,
  players,
  rivers,
  briefings,
  prompt_scores,
  feed_recommendations,
  feed_imports,
};
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

/** The column names SQLite reports for a table, sorted. */
function columnsOf(raw: DatabaseSync, table: string): readonly string[] {
  return raw
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row['name']))
    .toSorted((a, b) => a.localeCompare(b));
}

/** The names of the indexes SQLite reports for a table. */
function indexesOf(raw: DatabaseSync, table: string): readonly string[] {
  return raw
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((row) => String(row['name']));
}

/** The key columns of an index as SQLite reports them (an expression shows as such). */
function keyColumns(raw: DatabaseSync, index: string): readonly string[] {
  return raw
    .prepare(`PRAGMA index_info(${index})`)
    .all()
    .map((row) =>
      row['name'] === null ? '<expression>' : String(row['name']),
    );
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
        config.columns
          .map((column) => column.name)
          .toSorted((a, b) => a.localeCompare(b)),
      );
      // Every index the schema names exists (the database may carry more, such
      // as the legacy unique constraint on recipes.drive_file_id).
      const present = indexesOf(raw, name);
      config.indexes.forEach((index) =>
        expect(present).toContain(index.config.name),
      );
    },
  );

  it.each([...tables.keys()])(
    'declares every index the migrations create on %s, on the same columns',
    (name) => {
      const declared = new Map(
        getTableConfig(tables.get(name)!).indexes.map((index) => [
          index.config.name,
          index.config.columns.map((column) =>
            'name' in column ? column.name : '<expression>',
          ),
        ]),
      );
      const created = raw
        .prepare(`PRAGMA index_list(${name})`)
        .all()
        .filter((row) => row['origin'] === 'c')
        .map((row) => String(row['name']));
      expect(created.toSorted((a, b) => a.localeCompare(b))).toEqual(
        [...declared.keys()].toSorted((a, b) => a.localeCompare(b)),
      );
      created.forEach((index) =>
        expect(keyColumns(raw, index)).toEqual(declared.get(index)),
      );
    },
  );
});
