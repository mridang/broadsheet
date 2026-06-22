/**
 * @packageDocumentation
 *
 * The typed database schema — the single source of truth every query
 * composes against. Column names and JS keys are kept identical
 * (snake_case) so query results line up with the row types.
 *
 * The hand-written SQL migrations in `/migrations` remain authoritative;
 * this file mirrors their result so Drizzle can type the queries. Keep it
 * in sync when adding a migration (it matches the live D1 exactly).
 */

import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sub: text('sub').unique(),
  email: text('email'),
  name: text('name'),
  picture: text('picture'),
  created_at: text('created_at'),
});

export const feeds = sqliteTable(
  'feeds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    created_at: text('created_at'),
  },
  (t) => [unique().on(t.user_id, t.url)],
);

export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    feed_id: integer('feed_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    source: text('source'),
    image: text('image'),
    favicon: text('favicon'),
    summary: text('summary'),
    published_at: text('published_at'),
    /** The day this row was scraped (YYYY-MM-DD, UTC) — one edition per day. */
    edition: text('edition'),
    fetched_at: text('fetched_at'),
  },
  (t) => [unique().on(t.feed_id, t.url, t.edition)],
);

export type User = typeof users.$inferSelect;
export type Feed = typeof feeds.$inferSelect;
export type Article = typeof articles.$inferSelect;
