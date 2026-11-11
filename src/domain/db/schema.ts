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
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
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
export const sources = sqliteTable(
  'sources',
  {
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
    /** The WebSub hub the feed is subscribed at, for the topic it names. */
    websub_hub: text('websub_hub'),
    websub_topic: text('websub_topic'),
    /** The secret the hub signs its pushes with. */
    websub_secret: text('websub_secret'),
    /** When the hub's lease runs out; null until the hub verifies it. */
    websub_expires_at: text('websub_expires_at'),

    /**
     * How many subscriptions follow it. Kept by triggers on `subscriptions`
     * (migration 0035), so no query counts them.
     */
    follower_count: integer('follower_count').notNull().default(0),

    /**
     * How many distinct story addresses it has kept, however many editions
     * carry each. Kept by triggers on `articles` (migration 0035).
     */
    story_count: integer('story_count').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_sources_next_fetch').on(table.next_fetch_at),
    // Descending in the migration, which Drizzle cannot say; the order is the database's.
    index('idx_sources_followers').on(table.follower_count, table.id),
  ],
);

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
    /** A custom icon as JSON (type, data, color, set); null for none. */
    icon: text('icon'),
    /** Days until stories count as read: null inherits, 0 never. */
    auto_mark_read_days: integer('auto_mark_read_days'),
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
    /** The person's own icon for the feed as JSON; null for the feed's own. */
    custom_icon: text('custom_icon'),
    /** Days until stories count as read: null inherits, 0 never. */
    auto_mark_read_days: integer('auto_mark_read_days'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.user_id, table.source_id),
    index('idx_subscriptions_user').on(table.user_id),
    index('idx_subscriptions_source').on(table.source_id, table.created_at),
    index('idx_subscriptions_created').on(table.created_at, table.source_id),
  ],
);

/**
 * The sections a feed sits in besides its own `section_id` (where the paper
 * prints it): a feed can be filed in several, as a NewsBlur feed can sit in
 * several folders.
 */
export const subscription_sections = sqliteTable(
  'subscription_sections',
  {
    subscription_id: integer('subscription_id').notNull(),
    section_id: integer('section_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subscription_id, table.section_id] }),
    index('idx_subscription_sections_section').on(table.section_id),
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
    /** Where the story is discussed (RSS `<comments>`, or its HN thread). */
    comments_url: text('comments_url'),
    /** The feed's own id for the story, so a moved address is the same story. */
    guid: text('guid'),
    /** The summary the story first had, kept once a later fetch changed it. */
    original_summary: text('original_summary'),
    /** Who wrote it, as the feed names them. */
    author: text('author'),
    /** The feed's categories for it, as a JSON array. */
    tags: text('tags').notNull().default('[]'),
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
    index('idx_articles_source_published').on(
      table.source_id,
      sql`julianday(coalesce(nullif(published_at, ''), fetched_at))`,
      table.url,
    ),
  ],
);

/**
 * A person training the paper: `score` 1 likes, -1 dislikes and -2 super
 * dislikes stories whose `kind` matches `value`, everywhere or only in one
 * feed or section.
 */
export const classifiers = sqliteTable(
  'classifiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    score: integer('score').notNull(),
    /** Only stories of this feed (subscription), as NewsBlur's feed scope. */
    scope_feed_id: integer('scope_feed_id'),
    /** Only stories of this section's feeds, as NewsBlur's folder scope. */
    scope_section_id: integer('scope_section_id'),
    /** The value is a regular expression (title, author, text, url). */
    is_regex: integer('is_regex').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_classifiers_user').on(table.user_id)],
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
    notes: text('notes'),
    highlights: text('highlights').notNull().default('[]'),
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
    /** Seconds the person spent on the story (migration 0025). */
    seconds: integer('seconds').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.article_id] }),
    index('idx_reads_created').on(table.created_at),
    index('idx_reads_article').on(table.article_id),
  ],
);

/** One story as several sources covered it in one edition (migration 0008). */
export const clusters = sqliteTable(
  'clusters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    edition: text('edition').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_clusters_edition').on(table.edition)],
);

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
    /** The stories the note covers, as JSON {id, category} (migration 0023). */
    briefing_stories: text('briefing_stories'),
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
    briefing_stories: text('briefing_stories'),
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
    /** The first question, cut short (migration 0023). */
    title: text('title'),
    /** When the last turn was added (migration 0023). */
    updated_at: text('updated_at'),
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

/** A preset answer a person was given about an article, served again from here. */
export const answers = sqliteTable(
  'answers',
  {
    user_id: integer('user_id').notNull(),
    article_id: integer('article_id').notNull(),
    question_id: text('question_id').notNull(),
    answer: text('answer').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({
      columns: [table.user_id, table.article_id, table.question_id],
    }),
  ],
);

/**
 * One question asked of the model, for the daily budgets: `kind` is `answer`
 * or `assistant`; `cached` (0/1) marks an answer served from {@link answers}.
 */
export const ai_usage = sqliteTable(
  'ai_usage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    kind: text('kind').notNull(),
    cached: integer('cached').notNull().default(0),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_ai_usage_user').on(table.user_id, table.kind, table.created_at),
  ],
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
export const oauth_codes = sqliteTable(
  'oauth_codes',
  {
    code_hash: text('code_hash').primaryKey(),
    client_id: text('client_id').notNull(),
    user_id: integer('user_id').notNull(),
    redirect_uri: text('redirect_uri').notNull(),
    code_challenge: text('code_challenge').notNull(),
    scope: text('scope').notNull(),
    resource: text('resource').notNull(),
    expires_at: integer('expires_at').notNull(),
  },
  (table) => [index('idx_oauth_codes_expires').on(table.expires_at)],
);

/** An access or refresh token, stored as its hash; `kind` says which. */
export const oauth_tokens = sqliteTable(
  'oauth_tokens',
  {
    token_hash: text('token_hash').primaryKey(),
    kind: text('kind').notNull(),
    grant_id: text('grant_id').notNull(),
    expires_at: integer('expires_at').notNull(),
  },
  (table) => [
    index('idx_oauth_tokens_grant').on(table.grant_id),
    index('idx_oauth_tokens_expires').on(table.expires_at),
  ],
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
    search_id: integer('search_id'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
    /** All, unread (no disliked stories) or focus (only liked ones). */
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
  (table) => [
    primaryKey({ columns: [table.user_id, table.subscription_id] }),
    index('idx_feed_notifications_subscription').on(table.subscription_id),
  ],
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
  (table) => [
    primaryKey({ columns: [table.user_id, table.article_id] }),
    index('idx_notification_deliveries_emailed')
      .on(table.user_id, table.created_at)
      .where(sql`emailed = 1`),
  ],
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
export const savedSearches = sqliteTable(
  'saved_searches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    query: text('query').notNull(),
    feed_id: integer('feed_id'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_saved_searches_unique').on(
      table.user_id,
      table.query,
      sql`ifnull(feed_id, 0)`,
    ),
  ],
);

/** One fetch of a source: when, whether it worked and why not. */
export const fetchHistory = sqliteTable(
  'fetch_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source_id: integer('source_id').notNull(),
    fetched_at: text('fetched_at').default(sql`(datetime('now'))`),
    ok: integer('ok').notNull(),
    message: text('message'),
    duration_ms: integer('duration_ms'),
  },
  (table) => [index('idx_fetch_history_source').on(table.source_id, table.id)],
);

/**
 * A classifier that notifies: any new story whose `kind` (title, author, tag,
 * text or url) matches `value` (a regular expression when `is_regex` is 1), in
 * one feed, one section or every feed (`scope`), by each of `channels`.
 */
export const notification_rules = sqliteTable(
  'notification_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    is_regex: integer('is_regex').notNull().default(0),
    scope: text('scope').notNull().default('all'),
    subscription_id: integer('subscription_id'),
    section_id: integer('section_id'),
    channels: text('channels').notNull().default('[]'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_notification_rules_user').on(table.user_id)],
);

/** The day (YYYY-MM-DD) a person last used the app. */
export const user_activity = sqliteTable('user_activity', {
  user_id: integer('user_id').primaryKey(),
  last_seen_on: text('last_seen_on').notNull(),
});

/**
 * What a person chose about clustering and the editor's note (migration
 * 0019). Absent until they change something; the column defaults apply.
 */
export const preferences = sqliteTable('preferences', {
  user_id: integer('user_id').primaryKey(),
  story_clustering: integer('story_clustering').notNull().default(1),
  cluster_mode: text('cluster_mode').notNull().default('related'),
  cluster_mark_read: integer('cluster_mark_read').notNull().default(0),
  briefing_enabled: integer('briefing_enabled').notNull().default(1),
  briefing_story_count: integer('briefing_story_count').notNull().default(5),
  briefing_length: text('briefing_length').notNull().default('medium'),
  briefing_style: text('briefing_style').notNull().default('bullets'),
  briefing_read_filter: text('briefing_read_filter')
    .notNull()
    .default('unread'),
  /** How much training lets through: focus, unread (the default) or all. */
  intelligence: text('intelligence').notNull().default('unread'),
  /** Whether opening a story marks it read (0/1). */
  mark_read_on_open: integer('mark_read_on_open').notNull().default(1),
  /** Days after which stories count as read when no feed or section says; 0 never. */
  auto_mark_read_days: integer('auto_mark_read_days').notNull().default(0),
  /** Whether stories scrolled past are marked read (0/1). */
  mark_read_on_scroll: integer('mark_read_on_scroll').notNull().default(0),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
  // Migration 0027: the briefing's schedule, sources, model and sections,
  // and how a story's copies show.
  briefing_frequency: text('briefing_frequency').notNull().default('daily'),
  briefing_time: text('briefing_time').notNull().default('morning'),
  briefing_day: text('briefing_day').notNull().default('sun'),
  timezone: text('timezone').notNull().default('UTC'),
  briefing_sources: text('briefing_sources').notNull().default('all'),
  briefing_include_read: integer('briefing_include_read').notNull().default(0),
  briefing_model: text('briefing_model'),
  briefing_sections: text('briefing_sections'),
  briefing_section_order: text('briefing_section_order'),
  briefing_prompts: text('briefing_prompts'),
  cluster_preview_style: text('cluster_preview_style')
    .notNull()
    .default('single_line'),
});

/**
 * A story a person shared, with an optional comment. Shares are public:
 * listed with the sharer's name, never their email.
 */
export const shares = sqliteTable(
  'shares',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    article_id: integer('article_id').notNull(),
    comments: text('comments'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.user_id, table.article_id),
    index('idx_shares_created').on(table.created_at),
  ],
);

/**
 * Listening, as NewsBlur's media player keeps it: the person's playback rate,
 * the story being read and how far in, and the stories queued and heard.
 */
export const players = sqliteTable('players', {
  user_id: integer('user_id').primaryKey(),
  rate: real('rate').notNull().default(1),
  current_article_id: integer('current_article_id'),
  /** How far into the current story, as a character offset. */
  position: integer('position').notNull().default(0),
  /** JSON array of the article ids queued next. */
  queue: text('queue').notNull().default('[]'),
  /** JSON array of the article ids already heard, newest first. */
  history: text('history').notNull().default('[]'),
  updated_at: text('updated_at').default(sql`(datetime('now'))`),
});

/**
 * A story list a person pins to a column of their front page (migration
 * 0025). `river_id` names it (`all`, `saves`, `feed:{id}`, `section:{id}`,
 * `search:{id}`, `edition:{id}`); `side` is left or right and `position` its
 * place there.
 */
export const rivers = sqliteTable(
  'rivers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    river_id: text('river_id').notNull(),
    side: text('side').notNull(),
    position: integer('position').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [unique().on(table.user_id, table.side, table.position)],
);

/**
 * A briefing written for a person (migration 0029): one per slot of their
 * day (`morning`, `afternoon`, `evening`, or `custom` at their own time) and
 * local date. `stories` is a JSON array of {id, category}; `sections` the
 * JSON array of section keys it has; `status` is `complete` or `failed`.
 */
export const briefings = sqliteTable(
  'briefings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    slot: text('slot').notNull(),
    local_date: text('local_date').notNull(),
    frequency: text('frequency').notNull(),
    period_start: text('period_start').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    stories: text('stories').notNull().default('[]'),
    sections: text('sections').notNull().default('[]'),
    status: text('status').notNull(),
    error: text('error'),
    model: text('model'),
    tokens: integer('tokens'),
    seconds: real('seconds'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.user_id, table.slot, table.local_date),
    index('idx_briefings_user').on(table.user_id, table.created_at),
  ],
);

/**
 * Whether the AI found a story matches a person's `prompt` classifier, asked
 * once per story and prompt.
 */
export const prompt_scores = sqliteTable(
  'prompt_scores',
  {
    classifier_id: integer('classifier_id').notNull(),
    article_id: integer('article_id').notNull(),
    user_id: integer('user_id').notNull(),
    matched: integer('matched').notNull(),
    created_at: text('created_at').default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.classifier_id, table.article_id] }),
    index('idx_prompt_scores_user').on(table.user_id),
  ],
);

/**
 * A feed someone put forward for everyone (migration 0029): `status` is
 * `pending` until a curator makes it `approved` or `declined`, at `decided_at`.
 */
export const feed_recommendations = sqliteTable(
  'feed_recommendations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: integer('user_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    description: text('description').notNull(),
    status: text('status').notNull().default('pending'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
    decided_at: text('decided_at'),
  },
  (table) => [
    index('idx_feed_recommendations_status').on(table.status, table.decided_at),
  ],
);

/**
 * A large OPML import running in a Workflow: how far it got and what it did.
 * `status` is `running` until it is `complete` or `failed`; `rejected` is a
 * JSON list of `{url, reason}`.
 */
export const feed_imports = sqliteTable(
  'feed_imports',
  {
    id: text('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    status: text('status').notNull().default('running'),
    total: integer('total').notNull(),
    processed: integer('processed').notNull().default(0),
    added: integer('added').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    sections_added: integer('sections_added').notNull().default(0),
    rejected: text('rejected').notNull().default('[]'),
    created_at: text('created_at').default(sql`(datetime('now'))`),
    finished_at: text('finished_at'),
  },
  (table) => [index('idx_feed_imports_finished').on(table.finished_at)],
);
