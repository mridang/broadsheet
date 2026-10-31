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
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

/**
 * One row per signed-in person. `google_sub` is Google's stable id for the
 * account; `session_epoch` is raised to end every session the person has.
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  google_sub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  picture: text('picture'),
  session_epoch: integer('session_epoch').notNull().default(0),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

/**
 * A feed address, shared by everyone who follows it so it is fetched once.
 * `fail_count` counts the fetches that failed in a row.
 */
export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  title: text('title'),
  icon: text('icon'),
  last_fetched_at: text('last_fetched_at'),
  last_error: text('last_error'),
  fail_count: integer('fail_count').notNull().default(0),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

/** A heading a person groups their feeds under on the front page. */
export const sections = sqliteTable(
  'sections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_sections_user').on(table.user_id)],
);

/**
 * A person following a source: what the API calls a feed. Unique per
 * (user, source); `muted` (0/1) keeps it out of the paper.
 */
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    source_id: integer('source_id').notNull(),
    section_id: integer('section_id'),
    title_override: text('title_override'),
    muted: integer('muted').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.user_id, table.source_id),
    index('idx_subscriptions_user').on(table.user_id),
    index('idx_subscriptions_source').on(table.source_id),
  ],
);

/**
 * An article scraped from a source. The same URL can recur on different days,
 * so a row is unique per (source, URL, edition) and each day's scrape is kept
 * as its own edition. Editions are never pruned. `articles_fts` (migration
 * 0006, an FTS5 table Drizzle cannot describe) indexes the title, summary and
 * body text, kept in step by triggers.
 */
export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source_id: integer('source_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    source: text('source'),
    image: text('image'),
    favicon: text('favicon'),
    summary: text('summary'),
    published_at: text('published_at'),
    /** HN points/upvotes (0 for generic feeds without a score). */
    points: integer('points').default(0),
    /** The article's readable text, when its page was fetched. */
    body_text: text('body_text'),
    /** The day this row was scraped (YYYY-MM-DD, UTC) — one edition per day. */
    edition: text('edition'),
    fetched_at: text('fetched_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.source_id, table.url, table.edition),
    index('idx_articles_source_edition').on(table.source_id, table.edition),
    index('idx_articles_edition').on(table.edition),
  ],
);

/**
 * A person training the paper: `score` 1 likes and -1 dislikes stories whose
 * `kind` (author, source, title or tag) matches `value`.
 */
export const classifiers = sqliteTable(
  'classifiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    score: integer('score').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.user_id, table.kind, table.value),
    index('idx_classifiers_user').on(table.user_id),
  ],
);

/**
 * A story a person kept. Its article row outlives the edition being rewritten;
 * `tags` is a JSON array of the person's own labels.
 */
export const saves = sqliteTable(
  'saves',
  {
    user_id: integer('user_id').notNull(),
    article_id: integer('article_id').notNull(),
    tags: text('tags').notNull().default('[]'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.article_id] }),
    index('idx_saves_article').on(table.article_id),
  ],
);

/** A story a person has opened: dimmed today, left out of later editions. */
export const reads = sqliteTable(
  'reads',
  {
    user_id: integer('user_id').notNull(),
    article_id: integer('article_id').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.article_id] })],
);
