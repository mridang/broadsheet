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
  /** What the feed says about itself, read from its header on every fetch. */
  format: text('format'),
  site_url: text('site_url'),
  description: text('description'),
  language: text('language'),
  feed_updated_at: text('feed_updated_at'),
  update_minutes: integer('update_minutes'),
  /** Every header element, as JSON (`FeedElement[]`). */
  header: text('header'),
  /** The validators of the last answer, sent back for a conditional GET. */
  etag: text('etag'),
  last_modified: text('last_modified'),
  /** When the source may be fetched again; it backs off while failing. */
  next_fetch_at: text('next_fetch_at'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

/**
 * A heading a person groups their feeds under on the front page. A section
 * with a `parent_id` nests under that one.
 */
export const sections = sqliteTable(
  'sections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    parent_id: integer('parent_id'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_sections_user').on(table.user_id)],
);

/**
 * A person following a source: what the API calls a feed. Unique per
 * (user, source); `muted` (0/1) keeps it out of the paper, until
 * `muted_until` when that is set. `position` orders the person's feeds.
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
    muted_until: text('muted_until'),
    position: integer('position').notNull().default(0),
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
    /** The cluster of near-duplicates from other sources, when there is one. */
    cluster_id: integer('cluster_id'),
    fetched_at: text('fetched_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.source_id, table.url, table.edition),
    index('idx_articles_source_edition').on(table.source_id, table.edition),
    index('idx_articles_edition').on(table.edition),
    index('idx_articles_cluster').on(table.cluster_id),
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
    index('idx_saves_created').on(table.created_at),
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
  (table) => [
    primaryKey({ columns: [table.user_id, table.article_id] }),
    index('idx_reads_created').on(table.created_at),
  ],
);

/** One story as several sources covered it in one edition (migration 0008). */
export const clusters = sqliteTable('clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  edition: text('edition').notNull(),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});

/**
 * The paper a person was given on `date`: `layout` is the laid-out front page
 * as JSON and `briefing` the editor's note, when one was written.
 */
export const issues = sqliteTable(
  'issues',
  {
    user_id: integer('user_id').notNull(),
    date: text('date').notNull(),
    layout: text('layout').notNull(),
    briefing: text('briefing'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.date] })],
);

/**
 * A named paper a person keeps beside their default one (migration 0012).
 * `section_ids` is a JSON array of the sections it prints (empty for every
 * feed); `query` and `tag` narrow it to stories matching a search or saved
 * under a tag.
 */
export const editions = sqliteTable(
  'editions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    name: text('name').notNull(),
    section_ids: text('section_ids').notNull().default('[]'),
    query: text('query'),
    tag: text('tag'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_editions_user').on(table.user_id)],
);

/** The paper a custom edition printed on `date`, as `issues` keeps it. */
export const edition_issues = sqliteTable(
  'edition_issues',
  {
    edition_id: integer('edition_id').notNull(),
    date: text('date').notNull(),
    layout: text('layout').notNull(),
    briefing: text('briefing'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.edition_id, table.date] })],
);

/** One exchange a person has with the archive assistant. */
export const conversations = sqliteTable(
  'conversations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_conversations_user').on(table.user_id)],
);

/**
 * A turn of a conversation: the person's question (`role` user) or the
 * assistant's answer, with `citations` a JSON array of the article ids it drew on.
 */
export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    conversation_id: integer('conversation_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    citations: text('citations').notNull().default('[]'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_messages_conversation').on(table.conversation_id)],
);

/**
 * An assistant that registered itself to connect to `/mcp`. `redirect_uris`
 * is a JSON array; clients are public and prove themselves with PKCE.
 */
export const oauth_clients = sqliteTable('oauth_clients', {
  client_id: text('client_id').primaryKey(),
  client_name: text('client_name').notNull(),
  redirect_uris: text('redirect_uris').notNull(),
  created_at: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

/** One person's approval of one client; revoking it ends its tokens. */
export const oauth_grants = sqliteTable(
  'oauth_grants',
  {
    id: text('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    client_id: text('client_id').notNull(),
    scope: text('scope').notNull(),
    resource: text('resource').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    revoked_at: text('revoked_at'),
  },
  (table) => [index('idx_oauth_grants_user').on(table.user_id)],
);

/** A single-use authorization code, stored as its hash. */
export const oauth_codes = sqliteTable('oauth_codes', {
  code_hash: text('code_hash').primaryKey(),
  client_id: text('client_id').notNull(),
  user_id: integer('user_id').notNull(),
  redirect_uri: text('redirect_uri').notNull(),
  code_challenge: text('code_challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  expires_at: integer('expires_at').notNull(),
});

/** An access or refresh token, stored as its hash; `kind` says which. */
export const oauth_tokens = sqliteTable(
  'oauth_tokens',
  {
    token_hash: text('token_hash').primaryKey(),
    kind: text('kind').notNull(),
    grant_id: text('grant_id').notNull(),
    expires_at: integer('expires_at').notNull(),
  },
  (table) => [index('idx_oauth_tokens_grant').on(table.grant_id)],
);

/**
 * A browser that asked to be told when the day's issue is ready: the push
 * service `endpoint` and the keys (`p256dh`, `auth`) its payloads are
 * encrypted to.
 */
export const push_subscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_push_subscriptions_user').on(table.user_id)],
);

/**
 * An address told when the person saves or likes something. `events` is a
 * JSON array; `secret` signs each delivery.
 */
export const webhooks = sqliteTable(
  'webhooks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    url: text('url').notNull(),
    events: text('events').notNull().default('[]'),
    secret: text('secret').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_webhooks_user').on(table.user_id)],
);

/**
 * A token a feed reader fetches `/feed.xml` with. Only its SHA-256 is kept.
 * `scope` is saves (optionally one `tag`), section (`section_id`) or edition.
 */
export const feed_tokens = sqliteTable(
  'feed_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    token_hash: text('token_hash').notNull().unique(),
    scope: text('scope').notNull(),
    tag: text('tag'),
    section_id: integer('section_id'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
    /** all, unread (no disliked stories) or focus (only liked ones). */
    filter: text('filter').notNull().default('all'),
  },
  (table) => [index('idx_feed_tokens_user').on(table.user_id)],
);

/**
 * One of a person's feeds that tells them about new stories. `filter` is
 * unread (anything not disliked) or focus (only liked stories); `channels` is
 * a JSON array of web, email and webhook.
 */
export const feed_notifications = sqliteTable(
  'feed_notifications',
  {
    user_id: integer('user_id').notNull(),
    subscription_id: integer('subscription_id').notNull(),
    filter: text('filter').notNull().default('unread'),
    channels: text('channels').notNull().default('[]'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.subscription_id] })],
);

/** A story a person was told about; `emailed` (0/1) counts toward the daily email cap. */
export const notification_deliveries = sqliteTable(
  'notification_deliveries',
  {
    user_id: integer('user_id').notNull(),
    article_id: integer('article_id').notNull(),
    emailed: integer('emailed').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.article_id] })],
);

/** A story a person emailed to others, counted for their daily quota. */
export const story_emails = sqliteTable(
  'story_emails',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    article_id: integer('article_id').notNull(),
    recipients: integer('recipients').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_story_emails_user').on(table.user_id, table.created_at),
  ],
);

/**
 * A search a person keeps, optionally within one of their feeds
 * (`feed_id`, a subscription id). Unique per (user, query, feed) through an
 * expression index in migration 0016.
 */
export const savedSearches = sqliteTable('saved_searches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull(),
  query: text('query').notNull(),
  feed_id: integer('feed_id'),
  created_at: text('created_at').default(sql`(datetime('now'))`),
});
