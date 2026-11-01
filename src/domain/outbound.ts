/**
 * @packageDocumentation
 *
 * Data access for what leaves the paper on a person's behalf: the browsers
 * told when an issue is ready, the webhooks told when they save or like
 * something, and the tokens feed readers fetch `/feed.xml` with. Kept apart
 * from {@link Repository} so it grows without touching the reading side.
 */

import { and, desc, eq, getTableColumns, inArray, or } from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import {
  articles,
  feed_tokens,
  push_subscriptions,
  sections,
  subscription_sections,
  subscriptions,
  webhooks,
} from '@/domain/db/schema';
import {
  notMuted,
  sectionAndDescendants,
  type ArticleSummary,
} from '@/domain/repository';

/** A browser told when the day's issue is ready. */
export type PushSubscription = typeof push_subscriptions.$inferSelect;

/** What a browser hands over to subscribe. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * What a webhook can be told about: a save, a like, or a new story in a feed
 * whose notifications include webhooks (what NewsBlur sends IFTTT).
 */
export const WEBHOOK_EVENTS = ['save', 'like', 'story'] as const;

/** One kind of webhook delivery. */
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** An address told about saves and likes, with the events it wants. */
export interface Webhook {
  readonly id: number;
  readonly user_id: number;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly secret: string;
  readonly created_at: string | null;
}

/** What a feed token shows. */
export const FEED_SCOPES = ['saves', 'section', 'edition', 'search'] as const;

/** One kind of feed. */
export type FeedScope = (typeof FEED_SCOPES)[number];

/**
 * Which stories a section or edition feed keeps: all of them, the ones not
 * disliked (NewsBlur's unread), or only the liked ones (its focus).
 */
export const FEED_FILTERS = ['all', 'unread', 'focus'] as const;

/** One story filter. */
export type FeedFilter = (typeof FEED_FILTERS)[number];

/** A token a feed reader fetches `/feed.xml` with (its hash only). */
export type FeedToken = Omit<
  typeof feed_tokens.$inferSelect,
  'scope' | 'filter'
> & {
  readonly scope: FeedScope;
  readonly filter: FeedFilter;
};

/** What a new feed token shows. */
export interface FeedTokenInput {
  readonly scope: FeedScope;
  readonly tag?: string | undefined;
  readonly section_id?: number | undefined;
  /** The saved search a `search` feed follows. */
  readonly search_id?: number | undefined;
  readonly filter?: FeedFilter | undefined;
}

/** The events stored for a hook, keeping only the ones we know. */
function eventsOf(stored: string): WebhookEvent[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((e): e is WebhookEvent =>
          (WEBHOOK_EVENTS as readonly unknown[]).includes(e),
        )
      : [];
  } catch {
    return [];
  }
}

/** A stored hook row as a {@link Webhook}. */
function webhookOf(row: typeof webhooks.$inferSelect): Webhook {
  return { ...row, events: eventsOf(row.events) };
}

/** A stored token row as a {@link FeedToken}. */
function tokenOf(row: typeof feed_tokens.$inferSelect): FeedToken {
  return {
    ...row,
    scope: (FEED_SCOPES as readonly string[]).includes(row.scope)
      ? (row.scope as FeedScope)
      : 'saves',
    filter: (FEED_FILTERS as readonly string[]).includes(row.filter)
      ? (row.filter as FeedFilter)
      : 'all',
  };
}

/** The article columns a feed needs (no body text). */
const summaryColumns = Object.fromEntries(
  Object.entries(getTableColumns(articles)).filter(
    ([name]) => name !== 'body_text',
  ),
) as Omit<ReturnType<typeof getTableColumns<typeof articles>>, 'body_text'>;

/** The most stories one feed or one edition lists. */
const FEED_LIMIT = 100;

/** Queries over the outbound tables. */
export class OutboundRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Remember a browser for this person. An endpoint already known is moved to
   * them with its new keys; `created` says whether it is new.
   */
  async addPushSubscription(
    userId: number,
    input: PushSubscriptionInput,
  ): Promise<{ subscription: PushSubscription; created: boolean }> {
    const [before] = await this.#db
      .select({ id: push_subscriptions.id })
      .from(push_subscriptions)
      .where(eq(push_subscriptions.endpoint, input.endpoint))
      .limit(1);
    const [row] = await this.#db
      .insert(push_subscriptions)
      .values({ user_id: userId, ...input })
      .onConflictDoUpdate({
        target: push_subscriptions.endpoint,
        set: { user_id: userId, p256dh: input.p256dh, auth: input.auth },
      })
      .returning();
    return { subscription: row!, created: !before };
  }

  /** Forget one of the person's browsers. True when they had it. */
  async removePushSubscription(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(push_subscriptions)
      .where(
        and(
          eq(push_subscriptions.id, id),
          eq(push_subscriptions.user_id, userId),
        ),
      )
      .returning({ id: push_subscriptions.id });
    return removed.length > 0;
  }

  /** Forget a browser the push service says is gone. */
  async removePushEndpoint(endpoint: string): Promise<void> {
    await this.#db
      .delete(push_subscriptions)
      .where(eq(push_subscriptions.endpoint, endpoint));
  }

  /** The person's browsers, newest first. */
  pushSubscriptions(userId: number): Promise<PushSubscription[]> {
    return this.#db
      .select()
      .from(push_subscriptions)
      .where(eq(push_subscriptions.user_id, userId))
      .orderBy(desc(push_subscriptions.id));
  }

  /** Add a webhook. */
  async addWebhook(
    userId: number,
    url: string,
    events: readonly WebhookEvent[],
    secret: string,
  ): Promise<Webhook> {
    const [row] = await this.#db
      .insert(webhooks)
      .values({ user_id: userId, url, events: JSON.stringify(events), secret })
      .returning();
    return webhookOf(row!);
  }

  /** Remove one of the person's webhooks. True when they had it. */
  async removeWebhook(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.user_id, userId)))
      .returning({ id: webhooks.id });
    return removed.length > 0;
  }

  /** The person's webhooks, newest first. */
  async listWebhooks(userId: number): Promise<Webhook[]> {
    const rows = await this.#db
      .select()
      .from(webhooks)
      .where(eq(webhooks.user_id, userId))
      .orderBy(desc(webhooks.id));
    return rows.map(webhookOf);
  }

  /** The person's webhooks that want `event`. */
  async webhooksFor(userId: number, event: WebhookEvent): Promise<Webhook[]> {
    return (await this.listWebhooks(userId)).filter((h) =>
      h.events.includes(event),
    );
  }

  /** Keep a feed token by its hash. */
  async addFeedToken(
    userId: number,
    tokenHash: string,
    input: FeedTokenInput,
  ): Promise<FeedToken> {
    const [row] = await this.#db
      .insert(feed_tokens)
      .values({
        user_id: userId,
        token_hash: tokenHash,
        scope: input.scope,
        tag: input.tag ?? null,
        section_id: input.section_id ?? null,
        search_id: input.search_id ?? null,
        filter: input.filter ?? 'all',
      })
      .returning();
    return tokenOf(row!);
  }

  /** Revoke one of the person's feed tokens. True when they had it. */
  async removeFeedToken(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(feed_tokens)
      .where(and(eq(feed_tokens.id, id), eq(feed_tokens.user_id, userId)))
      .returning({ id: feed_tokens.id });
    return removed.length > 0;
  }

  /** The person's feed tokens, newest first. */
  async listFeedTokens(userId: number): Promise<FeedToken[]> {
    const rows = await this.#db
      .select()
      .from(feed_tokens)
      .where(eq(feed_tokens.user_id, userId))
      .orderBy(desc(feed_tokens.id));
    return rows.map(tokenOf);
  }

  /** The token with this hash, or undefined. */
  async feedTokenByHash(tokenHash: string): Promise<FeedToken | undefined> {
    const [row] = await this.#db
      .select()
      .from(feed_tokens)
      .where(eq(feed_tokens.token_hash, tokenHash))
      .limit(1);
    return row ? tokenOf(row) : undefined;
  }

  /**
   * The stories of the person's newest edition from the feeds they have not
   * muted, only those filed under `sectionId` when given; best first.
   */
  async editionStories(
    userId: number,
    sectionId?: number,
  ): Promise<ArticleSummary[]> {
    // A section takes in the sections nested in it, and a feed counts when
    // it is filed in any of them.
    const ids =
      sectionId === undefined
        ? undefined
        : [
            ...sectionAndDescendants(
              await this.#db
                .select()
                .from(sections)
                .where(eq(sections.user_id, userId)),
              sectionId,
            ),
          ];
    const followed = and(
      eq(subscriptions.user_id, userId),
      notMuted,
      ids === undefined
        ? undefined
        : or(
            inArray(subscriptions.section_id, ids),
            inArray(
              subscriptions.id,
              this.#db
                .select({ id: subscription_sections.subscription_id })
                .from(subscription_sections)
                .where(inArray(subscription_sections.section_id, ids)),
            ),
          ),
    );
    const [newest] = await this.#db
      .select({ edition: articles.edition })
      .from(articles)
      .innerJoin(subscriptions, eq(articles.source_id, subscriptions.source_id))
      .where(followed)
      .orderBy(desc(articles.edition))
      .limit(1);
    if (!newest?.edition) return [];
    return this.#db
      .select(summaryColumns)
      .from(articles)
      .innerJoin(subscriptions, eq(articles.source_id, subscriptions.source_id))
      .where(and(followed, eq(articles.edition, newest.edition)))
      .orderBy(desc(articles.points), desc(articles.id))
      .limit(FEED_LIMIT);
  }

  /** The kept text of these stories, by id (stories with none are left out). */
  async bodies(ids: readonly number[]): Promise<Map<number, string>> {
    const rows = [];
    // D1 binds at most about 100 values in one statement.
    for (let at = 0; at < ids.length; at += 90) {
      rows.push(
        ...(await this.#db
          .select({ id: articles.id, body: articles.body_text })
          .from(articles)
          .where(inArray(articles.id, ids.slice(at, at + 90)))),
      );
    }
    return new Map(
      rows.flatMap((r) => (r.body ? [[r.id, r.body] as const] : [])),
    );
  }
}
