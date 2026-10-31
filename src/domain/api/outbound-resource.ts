/**
 * @packageDocumentation
 *
 * What leaves the paper, on the wire: the representations of push
 * subscriptions, webhooks and feed tokens under `/api/users/self`, and
 * checking the bodies a client posts to make them.
 */

import {
  MAX_NAME_LENGTH,
  parseFeedId,
  rfc3339,
} from '@/domain/api/feed-resource';
import {
  FEED_SCOPES,
  WEBHOOK_EVENTS,
  type FeedScope,
  type FeedToken,
  type FeedTokenInput,
  type PushSubscription,
  type PushSubscriptionInput,
  type Webhook,
  type WebhookEvent,
} from '@/domain/outbound';
import { isPublicWebUrl } from '@/lib/safe-fetch';

/** A checked body, or what was wrong with it. */
export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The checked value, or the errors, from a list of errors. */
function checked<T>(errors: readonly string[], value: () => T): Checked<T> {
  return errors.length ? { ok: false, errors } : { ok: true, value: value() };
}

/** Errors for every member of `body` not in `allowed`. */
function strangers(
  body: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  what: string,
): string[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${key}: not a member of ${what}.`);
}

/** The created time, when the row has a readable one. */
function createdAt(stored: string | null): { created_at?: string } {
  const at = stored ? rfc3339(stored) : undefined;
  return at ? { created_at: at } : {};
}

/** Longest address we keep. */
const MAX_URL_LENGTH = 2048;

/** A base64url value of `min` to `max` characters. */
function isKey(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+={0,2}$/.test(value)
  );
}

/** A push subscription as the API shows it. */
export interface PushSubscriptionResource {
  readonly id: string;
  readonly endpoint: string;
  readonly created_at?: string;
}

/** The API's view of a stored push subscription. */
export function pushSubscriptionResource(
  row: Readonly<PushSubscription>,
): PushSubscriptionResource {
  return {
    id: String(row.id),
    endpoint: row.endpoint,
    ...createdAt(row.created_at),
  };
}

/**
 * Check a push subscription body: what the browser's
 * `PushSubscription.toJSON()` gives, an https `endpoint` and `keys` with
 * `p256dh` and `auth`. `expiration_time` (or the browser's own
 * `expirationTime`) is accepted and ignored.
 */
export function parsePushSubscriptionInput(
  body: Readonly<Record<string, unknown>>,
): Checked<PushSubscriptionInput> {
  const errors = strangers(
    body,
    ['endpoint', 'keys', 'expiration_time', 'expirationTime'],
    'a push subscription',
  );
  const { endpoint, keys } = body;
  if (
    typeof endpoint !== 'string' ||
    !endpoint.startsWith('https://') ||
    !isPublicWebUrl(endpoint)
  ) {
    errors.push('endpoint: must be a public https address.');
  }
  const pair =
    keys && typeof keys === 'object' && !Array.isArray(keys)
      ? (keys as Record<string, unknown>)
      : {};
  if (!isKey(pair['p256dh'], 80, 100)) {
    errors.push('keys.p256dh: must be the base64url P-256 public key.');
  }
  if (!isKey(pair['auth'], 16, 32)) {
    errors.push('keys.auth: must be the base64url auth secret.');
  }
  return checked(errors, () => ({
    endpoint: endpoint as string,
    p256dh: pair['p256dh'] as string,
    auth: pair['auth'] as string,
  }));
}

/** A webhook as the API shows it; `secret` only in the answer that made it. */
export interface WebhookResource {
  readonly id: string;
  readonly url: string;
  readonly events: readonly WebhookEvent[];
  readonly secret?: string;
  readonly created_at?: string;
}

/** The API's view of a webhook, with its secret when `reveal` says so. */
export function webhookResource(
  hook: Readonly<Webhook>,
  reveal = false,
): WebhookResource {
  return {
    id: String(hook.id),
    url: hook.url,
    events: hook.events,
    ...(reveal ? { secret: hook.secret } : {}),
    ...createdAt(hook.created_at),
  };
}

/** A checked webhook body. */
export interface WebhookInput {
  readonly url: string;
  readonly events: readonly WebhookEvent[];
}

/**
 * Check a webhook body: `url` a public https address, `events` a non-empty
 * list of save and like.
 */
export function parseWebhookInput(
  body: Readonly<Record<string, unknown>>,
): Checked<WebhookInput> {
  const errors = strangers(body, ['url', 'events'], 'a webhook');
  const { url, events } = body;
  if (
    typeof url !== 'string' ||
    url.length > MAX_URL_LENGTH ||
    !url.startsWith('https://') ||
    !isPublicWebUrl(url)
  ) {
    errors.push('url: must be a public https address.');
  }
  if (
    !Array.isArray(events) ||
    !events.length ||
    !events.every((e) => (WEBHOOK_EVENTS as readonly unknown[]).includes(e))
  ) {
    errors.push(
      `events: must be a non-empty list of ${WEBHOOK_EVENTS.join(', ')}.`,
    );
  }
  return checked(errors, () => ({
    url: url as string,
    events: [...new Set(events as WebhookEvent[])],
  }));
}

/** A feed token as the API shows it; `token` only in the answer that made it. */
export interface FeedTokenResource {
  readonly id: string;
  readonly scope: FeedScope;
  readonly tag?: string;
  readonly section_id?: string;
  readonly token?: string;
  readonly feed_url?: string;
  readonly created_at?: string;
}

/**
 * The API's view of a feed token. With `secret`, the token itself and the
 * feed address it opens, under `origin`.
 */
export function feedTokenResource(
  row: Readonly<FeedToken>,
  secret?: { readonly token: string; readonly origin: string },
): FeedTokenResource {
  return {
    id: String(row.id),
    scope: row.scope,
    ...(row.tag ? { tag: row.tag } : {}),
    ...(row.section_id !== null ? { section_id: String(row.section_id) } : {}),
    ...(secret
      ? {
          token: secret.token,
          feed_url: `${secret.origin}/feed.xml?token=${encodeURIComponent(secret.token)}`,
        }
      : {}),
    ...createdAt(row.created_at),
  };
}

/**
 * Check a feed token body: `scope` saves, section or edition. `tag` narrows
 * saves to one tag; `section_id` is required for, and only allowed with, a
 * section.
 */
export function parseFeedTokenInput(
  body: Readonly<Record<string, unknown>>,
): Checked<FeedTokenInput> {
  const errors = strangers(
    body,
    ['scope', 'tag', 'section_id'],
    'a feed token',
  );
  const { scope, tag, section_id: sectionId } = body;
  if (!(FEED_SCOPES as readonly unknown[]).includes(scope)) {
    errors.push(`scope: must be one of ${FEED_SCOPES.join(', ')}.`);
  }
  if (tag !== undefined) {
    if (scope !== 'saves') errors.push('tag: only for a saves feed.');
    else if (
      typeof tag !== 'string' ||
      !tag.trim() ||
      tag.trim().length > MAX_NAME_LENGTH
    )
      errors.push('tag: must be a non-blank string.');
  }
  const section =
    typeof sectionId === 'string' ? parseFeedId(sectionId) : undefined;
  if (scope === 'section' && section === undefined) {
    errors.push('section_id: must name one of your sections.');
  } else if (scope !== 'section' && sectionId !== undefined) {
    errors.push('section_id: only for a section feed.');
  }
  return checked(errors, () => ({
    scope: scope as FeedScope,
    ...(typeof tag === 'string' ? { tag: tag.trim() } : {}),
    ...(section !== undefined ? { section_id: section } : {}),
  }));
}

/** A checked email body. */
export interface EmailInput {
  readonly to: string;
}

/** Whether `value` looks like one email address. */
function isAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value)
  );
}

/** Check an email body: `to` is one address. */
export function parseEmailInput(
  body: Readonly<Record<string, unknown>>,
): Checked<EmailInput> {
  const errors = strangers(body, ['to'], 'an email');
  if (!isAddress(body['to'])) errors.push('to: must be one email address.');
  return checked(errors, () => ({ to: body['to'] as string }));
}
