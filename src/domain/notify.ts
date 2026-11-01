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
import { getDatabase, type Database } from '@/domain/db/database';
import { storyEmail, type EmailEnvironment } from '@/domain/api/emails';
import {
  NotificationRepository,
  type NotifiableStory,
  type NotificationChannel,
  type NotificationFilter,
} from '@/domain/notifications';
import { OutboundRepository, type WebhookEvent } from '@/domain/outbound';
import { verdict, type Verdict } from '@/domain/render/tiers';
import { matchesRule } from '@/domain/rules';
import { Repository, type User } from '@/domain/repository';
import { runInBackground } from '@/lib/core/runtime';
import { signatureHeaders } from '@/lib/outbound/signature';
import { WebPushSender, type PushPayload } from '@/lib/push';
import { fetchCapped, type SafeFetcher } from '@/lib/safe-fetch';
import { errorMessage, logError } from '@/utils/logging';

/** How we introduce ourselves to push services and webhook receivers. */
const USER_AGENT = `${BRAND_SHORT_NAME} (+${BRAND_URL})`;

/** How long one delivery may take. */
const TIMEOUT_MS = 10_000;

/** The most of a receiver's answer we read (we only want its status). */
const MAX_ANSWER_BYTES = 4096;

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
  if (result.ok) return { ok: true };
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
  const outcome = { sent: 0, failed: 0, removed: 0 };
  const vapid = vapidOf(env);
  if (!vapid) return outcome;
  const sender = new WebPushSender(vapid, {
    // Through safe-fetch, so a stored endpoint can only reach the public web.
    fetcher: async (url, init) => {
      const answer = await post(
        String(url),
        (init?.headers ?? {}) as Record<string, string>,
        init?.body ?? '',
        fetcher,
      );
      return new Response(null, {
        status: answer.ok ? 200 : (answer.status ?? 599),
      });
    },
  });
  for (const target of await repo.pushSubscriptions(userId)) {
    try {
      const result = await sender.send(target, payload);
      if (result.gone) {
        await repo.removePushEndpoint(target.endpoint);
        outcome.removed += 1;
      } else if (result.status >= 200 && result.status < 300) {
        outcome.sent += 1;
      } else {
        outcome.failed += 1;
      }
    } catch (error) {
      logError({ event: 'push.failed', error: errorMessage(error) });
      outcome.failed += 1;
    }
  }
  return outcome;
}

/**
 * Tell every browser the person subscribed that the issue for `edition`
 * (YYYY-MM-DD) is ready. Does nothing when the VAPID keys are not set.
 */
export function sendIssueReady(
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
    {
      title: BRAND_NAME,
      body: `Your paper for ${edition} is ready.`,
      tag: `issue-${edition}`,
      url: `${BRAND_URL}/?date=${edition}`,
    },
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
  let delivered = 0;
  for (const hook of hooks) {
    const at = now();
    const body = JSON.stringify({
      event,
      occurred_at: at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
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
      if (answer.ok) delivered += 1;
    } catch (error) {
      logError({ event: 'webhook.failed', error: errorMessage(error) });
    }
  }
  return delivered;
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
export type NotifyEnvironment = PushEnvironment & EmailEnvironment;

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
  if (!lastSeen) return true;
  const away = (Date.parse(edition) - Date.parse(lastSeen)) / 86_400_000;
  return !(away > INACTIVE_DAYS);
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
  readonly totals: {
    stories: number;
    pushed: number;
    emailed: number;
    hooked: number;
  };
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
): Promise<void> {
  if (!(await d.notifications.claimDelivery(d.userId, story.id))) return;
  d.totals.stories += 1;
  const title = story.title || story.url;
  if (channels.includes('web')) {
    const pushed = await pushToBrowsers(
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
    );
    d.totals.pushed += pushed.sent;
  }
  if (
    channels.includes('email') &&
    d.user &&
    (await emailNotification(
      d.env,
      d.notifications,
      d.user,
      feed.feed_title,
      story,
    ))
  ) {
    d.totals.emailed += 1;
  }
  if (channels.includes('webhook')) {
    d.totals.hooked += await deliverWebhooks(
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
    );
  }
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
  const totals = { stories: 0, pushed: 0, emailed: 0, hooked: 0 };
  const notifications = new NotificationRepository(db);
  const [settings, rules] = await Promise.all([
    notifications.feedNotifications(userId),
    notifications.rules(userId),
  ]);
  if (!settings.length && !rules.length) return totals;
  if (!stillActive(await notifications.lastSeen(userId), edition))
    return totals;
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
    totals,
  };
  for (const setting of settings) {
    const fresh = (
      await notifications.undeliveredStories(userId, setting.source_id, edition)
    ).filter((story) => notifies(setting.filter, verdict(story, training)));
    for (const story of fresh.slice(0, STORIES_PER_FEED)) {
      await deliverStory(delivery, setting, setting.channels, story);
    }
  }
  if (rules.length) {
    const followed = await notifications.undeliveredFollowedStories(
      userId,
      edition,
    );
    for (const rule of rules) {
      const matched = followed.filter((story) => matchesRule(rule, story));
      for (const story of matched.slice(0, STORIES_PER_FEED)) {
        await deliverStory(delivery, story, rule.channels, story);
      }
    }
  }
  return totals;
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
  if (!mail || !from) return false;
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
