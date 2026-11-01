/**
 * @packageDocumentation
 *
 * Data access for being told about new stories, as NewsBlur's per-feed
 * notifications are: which of a person's feeds notify them and how, which
 * stories they were already told about, and the counts behind the daily email
 * caps (stories emailed to the person, and stories they emailed to others).
 */

import { and, desc, eq, gt, notInArray, sql } from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import {
  articles,
  feed_notifications,
  notification_deliveries,
  notification_rules,
  sections,
  sources,
  story_emails,
  subscriptions,
  user_activity,
} from '@/domain/db/schema';
import { notMuted } from '@/domain/repository';

/** How a feed may notify: a web push, an email, or a webhook `story` event. */
export const NOTIFICATION_CHANNELS = ['web', 'email', 'webhook'] as const;

/** One way of being notified. */
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Which new stories notify: any not disliked (unread), or only liked ones (focus). */
export const NOTIFICATION_FILTERS = ['unread', 'focus'] as const;

/** One notification filter. */
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/** What a person chose for one feed. */
export interface NotificationSetting {
  readonly filter: NotificationFilter;
  readonly channels: readonly NotificationChannel[];
}

/** A feed that notifies, with what the delivery needs to know about it. */
export interface FeedNotification extends NotificationSetting {
  readonly feed_id: number;
  readonly source_id: number;
  readonly feed_title: string;
}

/** A new story a notification may be about. */
export interface NotifiableStory {
  readonly id: number;
  readonly title: string | null;
  readonly url: string;
  readonly source: string | null;
  readonly summary: string | null;
}

/**
 * What a notification rule matches on, as NewsBlur's classifier notifications
 * do; `prompt` asks Workers AI whether the story matches the reader's words.
 */
export const RULE_KINDS = [
  'title',
  'author',
  'tag',
  'text',
  'url',
  'prompt',
] as const;

/** One kind of rule. */
export type RuleKind = (typeof RULE_KINDS)[number];

/** The kinds a rule may match with a regular expression. */
export const REGEX_KINDS: readonly RuleKind[] = [
  'title',
  'author',
  'text',
  'url',
];

/** Where a rule looks: one feed, one section, or every feed. */
export const RULE_SCOPES = ['feed', 'section', 'all'] as const;

/** One rule scope. */
export type RuleScope = (typeof RULE_SCOPES)[number];

/** What a new rule is. */
export interface NotificationRuleInput {
  readonly kind: RuleKind;
  readonly value: string;
  readonly is_regex: boolean;
  readonly scope: RuleScope;
  readonly feed_id?: number | undefined;
  readonly section_id?: number | undefined;
  readonly channels: readonly NotificationChannel[];
}

/** A stored rule. */
export interface NotificationRule extends NotificationRuleInput {
  readonly id: number;
  readonly created_at: string | null;
}

/** A new story from any followed feed, with what rules match on. */
export interface FollowedStory extends NotifiableStory {
  readonly feed_id: number;
  readonly section_id: number | null;
  readonly feed_title: string;
  readonly body_text: string | null;
}

/** The channels stored for a setting, keeping only the ones we know. */
function channelsOf(stored: string): NotificationChannel[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is NotificationChannel =>
          (NOTIFICATION_CHANNELS as readonly unknown[]).includes(c),
        )
      : [];
  } catch {
    return [];
  }
}

/** A stored filter, unread unless it is focus. */
const filterOf = (stored: string): NotificationFilter =>
  stored === 'focus' ? 'focus' : 'unread';

/** A stored rule row as a {@link NotificationRule}. */
function ruleOf(row: typeof notification_rules.$inferSelect): NotificationRule {
  return {
    id: row.id,
    kind: (RULE_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as RuleKind)
      : 'title',
    value: row.value,
    is_regex: row.is_regex === 1,
    scope: (RULE_SCOPES as readonly string[]).includes(row.scope)
      ? (row.scope as RuleScope)
      : 'all',
    ...(row.subscription_id !== null ? { feed_id: row.subscription_id } : {}),
    ...(row.section_id !== null ? { section_id: row.section_id } : {}),
    channels: channelsOf(row.channels),
    created_at: row.created_at,
  };
}

/** Queries over the notification tables. */
export class NotificationRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Set how one of the person's feeds notifies them. Undefined when the feed
   * is not theirs; `created` says whether it notified before.
   */
  async setFeedNotification(
    userId: number,
    feedId: number,
    setting: NotificationSetting,
  ): Promise<{ created: boolean } | undefined> {
    const [feed] = await this.#db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, feedId), eq(subscriptions.user_id, userId)),
      )
      .limit(1);
    if (!feed) return undefined;
    const [before] = await this.#db
      .select({ id: feed_notifications.subscription_id })
      .from(feed_notifications)
      .where(
        and(
          eq(feed_notifications.user_id, userId),
          eq(feed_notifications.subscription_id, feedId),
        ),
      )
      .limit(1);
    const values = {
      filter: setting.filter,
      channels: JSON.stringify(setting.channels),
    };
    await this.#db
      .insert(feed_notifications)
      .values({ user_id: userId, subscription_id: feedId, ...values })
      .onConflictDoUpdate({
        target: [
          feed_notifications.user_id,
          feed_notifications.subscription_id,
        ],
        set: values,
      });
    return { created: !before };
  }

  /** Stop a feed notifying. True when it did. */
  async removeFeedNotification(
    userId: number,
    feedId: number,
  ): Promise<boolean> {
    const removed = await this.#db
      .delete(feed_notifications)
      .where(
        and(
          eq(feed_notifications.user_id, userId),
          eq(feed_notifications.subscription_id, feedId),
        ),
      )
      .returning({ id: feed_notifications.subscription_id });
    return removed.length > 0;
  }

  /** The person's notifying feeds that they still follow and have not muted. */
  async feedNotifications(userId: number): Promise<FeedNotification[]> {
    const rows = await this.#db
      .select({
        feed_id: subscriptions.id,
        source_id: subscriptions.source_id,
        title: subscriptions.title_override,
        source_title: sources.title,
        url: sources.url,
        filter: feed_notifications.filter,
        channels: feed_notifications.channels,
      })
      .from(feed_notifications)
      .innerJoin(
        subscriptions,
        eq(feed_notifications.subscription_id, subscriptions.id),
      )
      .innerJoin(sources, eq(subscriptions.source_id, sources.id))
      .where(and(eq(feed_notifications.user_id, userId), notMuted))
      .orderBy(subscriptions.id);
    return rows.map((r) => ({
      feed_id: r.feed_id,
      source_id: r.source_id,
      feed_title: r.title || r.source_title || r.url,
      filter: filterOf(r.filter),
      channels: channelsOf(r.channels),
    }));
  }

  /** Everyone who has a feed that notifies. */
  async notifiedUserIds(): Promise<number[]> {
    const rows = await this.#db
      .selectDistinct({ id: feed_notifications.user_id })
      .from(feed_notifications)
      .orderBy(feed_notifications.user_id);
    return rows.map((r) => r.id);
  }

  /**
   * The stories of a source's edition the person has not been told about,
   * newest first.
   */
  undeliveredStories(
    userId: number,
    sourceId: number,
    edition: string,
  ): Promise<NotifiableStory[]> {
    return this.#db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        source: articles.source,
        summary: articles.summary,
      })
      .from(articles)
      .where(
        and(
          eq(articles.source_id, sourceId),
          eq(articles.edition, edition),
          notInArray(
            articles.id,
            this.#db
              .select({ id: notification_deliveries.article_id })
              .from(notification_deliveries)
              .where(eq(notification_deliveries.user_id, userId)),
          ),
        ),
      )
      .orderBy(desc(articles.published_at), desc(articles.id));
  }

  /**
   * Claim a story for the person, so no rerun tells them again. False when it
   * was claimed already.
   */
  async claimDelivery(userId: number, articleId: number): Promise<boolean> {
    const added = await this.#db
      .insert(notification_deliveries)
      .values({ user_id: userId, article_id: articleId })
      .onConflictDoNothing()
      .returning({ id: notification_deliveries.article_id });
    return added.length > 0;
  }

  /** Note that a claimed story went to the person by email. */
  async markEmailed(userId: number, articleId: number): Promise<void> {
    await this.#db
      .update(notification_deliveries)
      .set({ emailed: 1 })
      .where(
        and(
          eq(notification_deliveries.user_id, userId),
          eq(notification_deliveries.article_id, articleId),
        ),
      );
  }

  /** How many notification emails the person got in the last day. */
  async emailsToday(userId: number): Promise<number> {
    const [row] = await this.#db
      .select({ n: sql<number>`count(*)` })
      .from(notification_deliveries)
      .where(
        and(
          eq(notification_deliveries.user_id, userId),
          eq(notification_deliveries.emailed, 1),
          gt(
            notification_deliveries.created_at,
            sql`datetime('now', '-1 day')`,
          ),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** Count a story the person emailed to `recipients` people. */
  async recordStoryEmail(
    userId: number,
    articleId: number,
    recipients: number,
  ): Promise<void> {
    await this.#db
      .insert(story_emails)
      .values({ user_id: userId, article_id: articleId, recipients });
  }

  /** How many stories the person emailed to others in the last day. */
  async storyEmailsToday(userId: number): Promise<number> {
    const [row] = await this.#db
      .select({ n: sql<number>`count(*)` })
      .from(story_emails)
      .where(
        and(
          eq(story_emails.user_id, userId),
          gt(story_emails.created_at, sql`datetime('now', '-1 day')`),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /**
   * Add a rule. Undefined when the feed or section it names is not the
   * person's.
   */
  async addRule(
    userId: number,
    input: NotificationRuleInput,
  ): Promise<NotificationRule | undefined> {
    if (input.feed_id !== undefined) {
      const [feed] = await this.#db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.id, input.feed_id),
            eq(subscriptions.user_id, userId),
          ),
        )
        .limit(1);
      if (!feed) return undefined;
    }
    if (input.section_id !== undefined) {
      const [section] = await this.#db
        .select({ id: sections.id })
        .from(sections)
        .where(
          and(eq(sections.id, input.section_id), eq(sections.user_id, userId)),
        )
        .limit(1);
      if (!section) return undefined;
    }
    const [row] = await this.#db
      .insert(notification_rules)
      .values({
        user_id: userId,
        kind: input.kind,
        value: input.value,
        is_regex: input.is_regex ? 1 : 0,
        scope: input.scope,
        subscription_id: input.feed_id ?? null,
        section_id: input.section_id ?? null,
        channels: JSON.stringify(input.channels),
      })
      .returning();
    return ruleOf(row!);
  }

  /** Remove one of the person's rules. True when they had it. */
  async removeRule(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(notification_rules)
      .where(
        and(
          eq(notification_rules.id, id),
          eq(notification_rules.user_id, userId),
        ),
      )
      .returning({ id: notification_rules.id });
    return removed.length > 0;
  }

  /** The person's rules, oldest first. */
  async rules(userId: number): Promise<NotificationRule[]> {
    const rows = await this.#db
      .select()
      .from(notification_rules)
      .where(eq(notification_rules.user_id, userId))
      .orderBy(notification_rules.id);
    return rows.map(ruleOf);
  }

  /** Everyone with a rule. */
  async ruleUserIds(): Promise<number[]> {
    const rows = await this.#db
      .selectDistinct({ id: notification_rules.user_id })
      .from(notification_rules)
      .orderBy(notification_rules.user_id);
    return rows.map((r) => r.id);
  }

  /**
   * The stories of `edition` from every feed the person follows and has not
   * muted that they have not been told about, newest first.
   */
  async undeliveredFollowedStories(
    userId: number,
    edition: string,
  ): Promise<FollowedStory[]> {
    const rows = await this.#db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        source: articles.source,
        summary: articles.summary,
        body_text: articles.body_text,
        feed_id: subscriptions.id,
        section_id: subscriptions.section_id,
        title_override: subscriptions.title_override,
        source_title: sources.title,
        feed_url: sources.url,
      })
      .from(articles)
      .innerJoin(subscriptions, eq(articles.source_id, subscriptions.source_id))
      .innerJoin(sources, eq(subscriptions.source_id, sources.id))
      .where(
        and(
          eq(subscriptions.user_id, userId),
          eq(subscriptions.muted, 0),
          eq(articles.edition, edition),
          notInArray(
            articles.id,
            this.#db
              .select({ id: notification_deliveries.article_id })
              .from(notification_deliveries)
              .where(eq(notification_deliveries.user_id, userId)),
          ),
        ),
      )
      .orderBy(desc(articles.published_at), desc(articles.id));
    return rows.map(({ title_override, source_title, feed_url, ...story }) => ({
      ...story,
      feed_title: title_override || source_title || feed_url,
    }));
  }

  /** Note that the person used the app on `day` (YYYY-MM-DD). */
  async noteSeen(userId: number, day: string): Promise<void> {
    await this.#db
      .insert(user_activity)
      .values({ user_id: userId, last_seen_on: day })
      .onConflictDoUpdate({
        target: user_activity.user_id,
        set: { last_seen_on: day },
      });
  }

  /** The day the person last used the app, or undefined when never noted. */
  async lastSeen(userId: number): Promise<string | undefined> {
    const [row] = await this.#db
      .select({ day: user_activity.last_seen_on })
      .from(user_activity)
      .where(eq(user_activity.user_id, userId))
      .limit(1);
    return row?.day;
  }
}
