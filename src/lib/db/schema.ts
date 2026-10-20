/**
 * @packageDocumentation
 *
 * The typed database schema — the single source of truth every repository
 * composes queries against. Column names and JS keys are kept identical
 * (snake_case) so query results line up with the row types.
 *
 * The hand-written SQL migrations in `/migrations` remain authoritative;
 * this file mirrors their result so Drizzle can type the queries. Keep it
 * in sync when adding a migration (it matches the live D1 exactly).
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

/** One row per signed-in person. `sub` is the identity provider's stable user id. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sub: text('sub').unique(),
  email: text('email'),
  name: text('name'),
  picture: text('picture'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

/** A feed a user follows, unique per (user, URL). */
export const feeds = sqliteTable(
  'feeds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.user_id, table.url),
    index('idx_feeds_user').on(table.user_id),
  ],
);

/**
 * An article scraped from a feed. The same URL can recur on different days, so
 * a row is unique per (feed, URL, edition) and each day's scrape is kept as
 * its own edition.
 */
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
    /** HN points/upvotes (0 for generic feeds without a score). */
    points: integer('points').default(0),
    /** The day this row was scraped (YYYY-MM-DD, UTC) — one edition per day. */
    edition: text('edition'),
    fetched_at: text('fetched_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.feed_id, table.url, table.edition),
    index('idx_articles_feed_edition').on(table.feed_id, table.edition),
    index('idx_articles_edition').on(table.edition),
  ],
);
