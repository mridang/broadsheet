/**
 * @packageDocumentation
 *
 * Telling people's other things that something happened: a push to their
 * browsers when the day's issue is ready, and a signed POST to their webhooks
 * when they save or like something. Both go out through `safe-fetch`, so a
 * stored address can only ever reach the public web, and neither throws: a
 * delivery that fails is logged and the rest go on.
 *
 * {@link sendIssueReady} is what the daily Workflow calls once a person's
 * issue is written; it is handed the environment and database rather than
 * reaching for the request context, which a Workflow step does not have.
 */

import { BRAND_NAME, BRAND_SHORT_NAME, BRAND_URL } from '@/app/_brand';
import { getDatabase } from '@/domain/db/client';
import { storyEmail } from '@/domain/api/emails';
import { NotificationRepository } from '@/domain/notifications';
import { OutboundRepository } from '@/domain/outbound';
import { verdict } from '@/domain/render/tiers';
import { askPrompt, PROMPT_BATCH } from '@/domain/prompts';
import { inScope, matchesRule } from '@/domain/rules';
import { budget } from '@/domain/api/usage';
import { Repository } from '@/domain/repository';
import { runInBackground } from '@/lib/core/runtime';
import { signatureHeaders } from '@/lib/outbound/signature';
import { WebPushSender } from '@/lib/push';
import { fetchCapped } from '@/lib/safe-fetch';
import { errorMessage, logError } from '@/utils/logging';
import type { PushPayload } from '@/lib/push';
import type { SafeFetcher } from '@/lib/safe-fetch';
import type { User } from '@/domain/repository';
import type { Verdict } from '@/domain/render/tiers';
import type { WebhookEvent } from '@/domain/outbound';
import type {
  FollowedStory,
  NotifiableStory,
  NotificationRule,
  NotificationChannel,
  NotificationFilter,
} from '@/domain/notifications';
import type { EmailEnvironment } from '@/domain/api/emails';
import type { Database } from '@/domain/db/client';

const DELIVER_WEBHOOKS_PATTERN = /\.\d{3}Z$/u;

/** How we introduce ourselves to push services and webhook receivers. */
const USER_AGENT = `${BRAND_SHORT_NAME} (+${BRAND_URL})`;

/** How long one delivery may take. */
const TIMEOUT_MS = 10_000;

/** The most of a receiver's answer we read (we only want its status). */
const MAX_ANSWER_BYTES = 4096;

/**
 * The headers of a request as a record: the names as they were written when
 * they came as one, lower-cased when they came as a `Headers` or a list of pairs.
 */
function headerRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  return headers === undefined || Symbol.iterator in headers
    ? Object.fromEntries(new Headers(headers))
    : headers;
}

/** POST `body` to `url`, following no redirect; the status, or undefined when unreachable. */
async function post(
  url: string,
  headers: Record<string, string>,
  body: BodyInit,
  fetcher?: SafeFetcher,
): Promise<{ readonly ok: boolean; readonly status?: number }> {
  const result = await fetchCapped(url, {
    method: 'POST',
    headers,
    body,
    accept: '*/*',
    acceptsType: () => true,
    maxBytes: MAX_ANSWER_BYTES,
    overflow: 'truncate',
    maxRedirects: 0,
    timeoutMs: TIMEOUT_MS,
    userAgent: USER_AGENT,
    ...(fetcher ? { fetcher } : {}),
  });
  if (result.ok) {
    return { ok: true };
  }
  return result.reason === 'status'
    ? { ok: false, status: result.status }
    : { ok: false };
}

/** The VAPID identity the push needs. */
export interface PushEnvironment {
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
}

/** What one round of pushes came to. */
export interface PushOutcome {
  readonly sent: number;
  readonly failed: number;
  /** Browsers the push service said were gone, now forgotten. */
  readonly removed: number;
}

/** The VAPID identity, when every part of it is set. */
function vapidOf(env: PushEnvironment) {
  const {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: subject,
  } = env;
  return publicKey && privateKey && subject
    ? { publicKey, privateKey, subject }
    : undefined;
}

/**
 * Push `payload` to every browser the person subscribed, forgetting the ones
 * the push service says are gone. Does nothing when the VAPID keys are not set.
 */
async function pushToBrowsers(
  env: PushEnvironment,
  repo: OutboundRepository,
  userId: number,
  payload: PushPayload,
  fetcher?: SafeFetcher,
): Promise<PushOutcome> {
  const outcome: PushOutcome = { sent: 0, failed: 0, removed: 0 };
  const vapid = vapidOf(env);
  if (!vapid) {
    return outcome;
  }
  const sender = new WebPushSender(vapid, {
    // Through safe-fetch, so a stored endpoint can only reach the public web.
    fetcher: async (url, init) => {
      const answer = await post(
        url instanceof Request ? url.url : String(url),
        headerRecord(init?.headers),
        init?.body ?? '',
        fetcher,
      );
      return new Response(null, {
        status: answer.ok ? 200 : (answer.status ?? 599),
      });
    },
  });
  const targets = await repo.pushSubscriptions(userId);
  return targets.reduce<Promise<PushOutcome>>(async (previous, target) => {
    const current = await previous;
    try {
      const result = await sender.send(target, payload);
      if (result.gone) {
        await repo.removePushEndpoint(target.endpoint);
        return { ...current, removed: current.removed + 1 };
      }
      return result.status >= 200 && result.status < 300
        ? { ...current, sent: current.sent + 1 }
        : { ...current, failed: current.failed + 1 };
    } catch (error) {
      logError({ event: 'push.failed', error: errorMessage(error) });
      return { ...current, failed: current.failed + 1 };
    }
  }, Promise.resolve(outcome));
}

/** The notice that the issue for `edition` is ready: it opens that day's paper. */
export function issueReadyNotice(edition: string) {
  return {
    title: BRAND_NAME,
    body: `Your paper for ${edition} is ready.`,
    tag: `issue-${edition}`,
    url: `${BRAND_URL}/edition/${edition}`,
  };
}

/** The notice that briefing `id`, called `title`, is ready. */
export function briefingReadyNotice(id: number, title: string) {
  return {
    title: BRAND_NAME,
    body: `${title} is ready.`,
    tag: `briefing-${id}`,
    url: `${BRAND_URL}/api/editions/self/briefings/${id}`,
  };
}

/**
 * Tell every browser the person subscribed that the issue for `edition`
 * (YYYY-MM-DD) is ready. Does nothing when the VAPID keys are not set.
 */
export async function sendIssueReady(
  env: PushEnvironment,
  db: Database,
  userId: number,
  edition: string,
  fetcher?: SafeFetcher,
): Promise<PushOutcome> {
  return pushToBrowsers(
    env,
    new OutboundRepository(db),
    userId,
    issueReadyNotice(edition),
    fetcher,
  );
}

/**
 * Tell every browser the person subscribed that a briefing (`title`, stored
 * as `id`) is ready. Does nothing when the VAPID keys are not set.
 */
export async function sendBriefingReady(
  env: PushEnvironment,
  db: Database,
  userId: number,
  id: number,
  title: string,
  fetcher?: SafeFetcher,
): Promise<PushOutcome> {
  return pushToBrowsers(
    env,
    new OutboundRepository(db),
    userId,
    briefingReadyNotice(id, title),
    fetcher,
  );
}

/**
 * Deliver `event` with `data` to each of the person's webhooks that wants it,
 * signed with the hook's secret. The number delivered.
 */
export async function deliverWebhooks(
  db: Database,
  userId: number,
  event: WebhookEvent,
  data: unknown,
  fetcher?: SafeFetcher,
  now: () => Date = () => new Date(),
): Promise<number> {
  const hooks = await new OutboundRepository(db).webhooksFor(userId, event);
  return hooks.reduce<Promise<number>>(async (previous, hook) => {
    const delivered = await previous;
    const at = now();
    const body = JSON.stringify({
      event,
      occurred_at: at.toISOString().replace(DELIVER_WEBHOOKS_PATTERN, 'Z'),
      data,
    });
    try {
      const answer = await post(
        hook.url,
        {
          'Content-Type': 'application/json',
          ...(await signatureHeaders(
            hook.secret,
            body,
            Math.floor(at.getTime() / 1000),
          )),
        },
        body,
        fetcher,
      );
      return answer.ok ? delivered + 1 : delivered;
    } catch (error) {
      logError({ event: 'webhook.failed', error: errorMessage(error) });
      return delivered;
    }
  }, Promise.resolve(0));
}

/** Deliver a webhook event after the response has gone, from a request. */
export function fireWebhooks(
  userId: number,
  event: WebhookEvent,
  data: unknown,
): void {
  runInBackground(deliverWebhooks(getDatabase(), userId, event, data));
}

/** Most stories one feed notifies about in one run, as NewsBlur caps it. */
export const STORIES_PER_FEED = 3;

/** Most notification emails one person gets in a day. */
export const DAILY_NOTIFICATION_EMAILS = 25;

/** What notifying needs: the VAPID identity and the mail binding. */
export type NotifyEnvironment = PushEnvironment &
  EmailEnvironment & {
    /** Workers AI, which judges stories against prompt rules. */
    readonly AI?: Pick<Ai, 'run'>;
  };

/** What one round of story notifications came to. */
export interface StoryNotifications {
  readonly stories: number;
  readonly pushed: number;
  readonly emailed: number;
  readonly hooked: number;
}

/** Whether a story with this verdict notifies under this filter. */
export function notifies(filter: NotificationFilter, score: Verdict): boolean {
  return filter === 'focus' ? score > 0 : score >= 0;
}

/** How long someone may be away before notifications stop, in days. */
export const INACTIVE_DAYS = 90;

/** Whether a person last seen on `lastSeen` is still active on `edition`. */
export function stillActive(
  lastSeen: string | undefined,
  edition: string,
): boolean {
  if (!lastSeen) {
    return true;
  }
  const away = (Date.parse(edition) - Date.parse(lastSeen)) / 86_400_000;
  return away <= INACTIVE_DAYS || Number.isNaN(away);
}

/** Everything delivering one story needs. */
interface Delivery {
  readonly env: NotifyEnvironment;
  readonly db: Database;
  readonly userId: number;
  readonly user: Pick<User, 'id' | 'email'> | undefined;
  readonly notifications: NotificationRepository;
  readonly outbound: OutboundRepository;
  readonly fetcher: SafeFetcher | undefined;
}

/**
 * Tell the person about one story, from `feed`, by each of `channels`. Does
 * nothing when the story was already claimed (by another feed or rule, or an
 * earlier run).
 */
async function deliverStory(
  d: Delivery,
  feed: { readonly feed_id: number; readonly feed_title: string },
  channels: readonly NotificationChannel[],
  story: NotifiableStory,
  totals: StoryNotifications,
): Promise<StoryNotifications> {
  if (!(await d.notifications.claimDelivery(d.userId, story.id))) {
    return totals;
  }
  const title = story.title || story.url;
  const pushedTo = channels.includes('web')
    ? await pushToBrowsers(
        d.env,
        d.outbound,
        d.userId,
        {
          title: feed.feed_title,
          body: title,
          tag: `story-${story.id}`,
          url: `${BRAND_URL}/article/${story.id}`,
        },
        d.fetcher,
      )
    : undefined;
  const pushed = pushedTo?.sent ?? 0;
  const emailed =
    channels.includes('email') &&
    d.user &&
    (await emailNotification(
      d.env,
      d.notifications,
      d.user,
      feed.feed_title,
      story,
    ))
      ? 1
      : 0;
  const hooked = channels.includes('webhook')
    ? await deliverWebhooks(
        d.db,
        d.userId,
        'story',
        {
          article_id: String(story.id),
          feed_id: String(feed.feed_id),
          feed_title: feed.feed_title,
          title,
          url: story.url,
          ...(story.summary ? { summary: story.summary } : {}),
        },
        d.fetcher,
      )
    : 0;
  return {
    stories: totals.stories + 1,
    pushed: totals.pushed + pushed,
    emailed: totals.emailed + emailed,
    hooked: totals.hooked + hooked,
  };
}

/**
 * Tell the person about the new stories in `edition`, as NewsBlur does.
 *
 * Each feed they set to notify sends the stories they have not been told
 * about, at most {@link STORIES_PER_FEED} a feed, not disliked ones (unread)
 * or only liked ones (focus). Each notification rule then sends the stories
 * from its feed, section or every feed that it matches, at most
 * {@link STORIES_PER_FEED} a rule. A story goes out once, whichever feed or
 * rule found it first. Web pushes go to every subscribed browser; emails go
 * to the person's own address, at most {@link DAILY_NOTIFICATION_EMAILS} a day
 * and only once Email Sending is set up; webhooks get a `story` event. Nobody
 * away for more than {@link INACTIVE_DAYS} days is told anything.
 */
export async function notifyNewStories(
  env: NotifyEnvironment,
  db: Database,
  userId: number,
  edition: string,
  fetcher?: SafeFetcher,
): Promise<StoryNotifications> {
  const totals: StoryNotifications = {
    stories: 0,
    pushed: 0,
    emailed: 0,
    hooked: 0,
  };
  const notifications = new NotificationRepository(db);
  const [settings, rules] = await Promise.all([
    notifications.feedNotifications(userId),
    notifications.rules(userId),
  ]);
  if (settings.length === 0 && rules.length === 0) {
    return totals;
  }
  if (!stillActive(await notifications.lastSeen(userId), edition)) {
    return totals;
  }
  const repo = new Repository(db);
  const [training, user] = await Promise.all([
    repo.listClassifiers(userId),
    repo.getUser(userId),
  ]);
  const delivery: Delivery = {
    env,
    db,
    userId,
    user,
    notifications,
    outbound: new OutboundRepository(db),
    fetcher,
  };
  const afterFeeds = await settings.reduce<Promise<StoryNotifications>>(
    async (previous, setting) => {
      const current = await previous;
      const unsent = await notifications.undeliveredStories(
        userId,
        setting.source_id,
        edition,
      );
      const fresh = unsent.filter((story) =>
        notifies(setting.filter, verdict(story, training)),
      );
      return fresh
        .slice(0, STORIES_PER_FEED)
        .reduce<Promise<StoryNotifications>>(
          async (running, story) =>
            deliverStory(
              delivery,
              setting,
              setting.channels,
              story,
              await running,
            ),
          Promise.resolve(current),
        );
    },
    Promise.resolve(totals),
  );
  if (rules.length === 0) {
    return afterFeeds;
  }
  const followed = await notifications.undeliveredFollowedStories(
    userId,
    edition,
  );
  return rules.reduce<Promise<StoryNotifications>>(async (previous, rule) => {
    const current = await previous;
    const matched =
      rule.kind === 'prompt'
        ? await promptMatches(env, repo, userId, rule, followed)
        : followed.filter((story) => matchesRule(rule, story));
    return matched
      .slice(0, STORIES_PER_FEED)
      .reduce<Promise<StoryNotifications>>(
        async (running, story) =>
          deliverStory(delivery, story, rule.channels, story, await running),
        Promise.resolve(current),
      );
  }, Promise.resolve(afterFeeds));
}

/**
 * The stories in a prompt rule's scope that Workers AI says match it, at most
 * {@link STORIES_PER_FEED}. Each question counts against the person's daily AI
 * classifier budget, as the prompt classifiers' do; none are asked without
 * Workers AI, and a question the model fails or will not answer matches
 * nothing.
 */
export async function promptMatches(
  env: NotifyEnvironment,
  repo: Repository,
  userId: number,
  rule: NotificationRule,
  followed: readonly FollowedStory[],
): Promise<FollowedStory[]> {
  const ai = env.AI;
  if (!ai) {
    return [];
  }
  const candidates = followed
    .filter((story) => inScope(rule, story))
    .slice(0, PROMPT_BATCH);
  const quota = await budget(repo, userId, 'classifier');
  const { matched } = await candidates.reduce<
    Promise<{ matched: FollowedStory[]; left: number }>
  >(
    async (previous, story) => {
      const state = await previous;
      if (state.matched.length >= STORIES_PER_FEED || state.left <= 0) {
        return state;
      }
      const left = state.left - 1;
      try {
        const hit = await askPrompt(ai, rule.value, story);
        const next = {
          matched: hit ? [...state.matched, story] : state.matched,
          left,
        };
        try {
          await repo.recordUsage(userId, 'classifier');
        } catch (error) {
          logError({
            event: 'notification.prompt.failed',
            error: errorMessage(error),
          });
        }
        return next;
      } catch (error) {
        logError({
          event: 'notification.prompt.failed',
          error: errorMessage(error),
        });
        return { matched: state.matched, left };
      }
    },
    Promise.resolve({ matched: [] as FollowedStory[], left: quota.remaining }),
  );
  return matched;
}

/**
 * Email one new story to the person. False when email is not set up, the
 * daily cap is reached, or the mail service refused.
 */
async function emailNotification(
  env: EmailEnvironment,
  notifications: NotificationRepository,
  user: Pick<User, 'id' | 'email'>,
  feedTitle: string,
  story: NotifiableStory,
): Promise<boolean> {
  const { EMAIL: mail, EMAIL_FROM: from } = env;
  if (!mail || !from) {
    return false;
  }
  if ((await notifications.emailsToday(user.id)) >= DAILY_NOTIFICATION_EMAILS) {
    return false;
  }
  const { subject, text, html } = storyEmail(story);
  try {
    await mail.send({
      from: { email: from, name: BRAND_NAME },
      to: user.email,
      subject: `${feedTitle}: ${subject}`,
      text,
      html,
    });
  } catch (error) {
    logError({
      event: 'notification.email.failed',
      error: errorMessage(error),
    });
    return false;
  }
  await notifications.markEmailed(user.id, story.id);
  return true;
}
