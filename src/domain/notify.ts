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

import {
  BRAND_NAME,
  BRAND_SHORT_NAME,
  BRAND_URL,
  SECURITY_CONTACT,
} from '@/app/_brand';
import { getDatabase, type Database } from '@/domain/db/database';
import { OutboundRepository, type WebhookEvent } from '@/domain/outbound';
import { runInBackground } from '@/lib/core/runtime';
import { signatureHeaders } from '@/lib/outbound/signature';
import { pushRequest } from '@/lib/outbound/web-push';
import { fetchCapped, type SafeFetcher } from '@/lib/safe-fetch';
import { errorMessage, logError } from '@/utils/logging';

/** How we introduce ourselves to push services and webhook receivers. */
const USER_AGENT = `${BRAND_SHORT_NAME} (+${BRAND_URL})`;

/** How long one delivery may take. */
const TIMEOUT_MS = 10_000;

/** The most of a receiver's answer we read (we only want its status). */
const MAX_ANSWER_BYTES = 4096;

/** Push service answers that mean the browser has gone away for good. */
const GONE = new Set([404, 410]);

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

/** The VAPID secrets the push needs. */
export type PushEnvironment = Partial<
  Pick<CloudflareEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY'>
>;

/** What one round of pushes came to. */
export interface PushOutcome {
  readonly sent: number;
  readonly failed: number;
  /** Browsers the push service said were gone, now forgotten. */
  readonly removed: number;
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
  const outcome = { sent: 0, failed: 0, removed: 0 };
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  if (!publicKey || !privateKey) return outcome;
  const repo = new OutboundRepository(db);
  const payload = JSON.stringify({
    title: BRAND_NAME,
    body: `Your paper for ${edition} is ready.`,
    tag: `issue-${edition}`,
    url: `${BRAND_URL}/?date=${edition}`,
  });
  for (const target of await repo.pushSubscriptions(userId)) {
    try {
      const request = await pushRequest(target, payload, {
        publicKey,
        privateKey,
        subject: SECURITY_CONTACT,
      });
      const answer = await post(
        target.endpoint,
        request.headers,
        request.body,
        fetcher,
      );
      if (answer.ok) {
        outcome.sent += 1;
      } else if (answer.status !== undefined && GONE.has(answer.status)) {
        await repo.removePushEndpoint(target.endpoint);
        outcome.removed += 1;
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
