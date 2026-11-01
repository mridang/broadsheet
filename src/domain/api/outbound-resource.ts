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
  FEED_FILTERS,
  FEED_SCOPES,
  WEBHOOK_EVENTS,
  type FeedFilter,
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
  readonly filter: FeedFilter;
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
    filter: row.filter,
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
 * Check a feed token body: `scope` saves, section or edition. `filter` (all,
 * unread or focus) keeps a section or edition feed to stories not disliked or
 * only liked ones, as NewsBlur's folder feeds do. `tag` narrows
 * saves to one tag; `section_id` is required for, and only allowed with, a
 * section.
 */
export function parseFeedTokenInput(
  body: Readonly<Record<string, unknown>>,
): Checked<FeedTokenInput> {
  const errors = strangers(
    body,
    ['scope', 'tag', 'section_id', 'filter'],
    'a feed token',
  );
  const { scope, tag, section_id: sectionId, filter } = body;
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
  if (filter !== undefined) {
    if (!(FEED_FILTERS as readonly unknown[]).includes(filter)) {
      errors.push(`filter: must be one of ${FEED_FILTERS.join(', ')}.`);
    } else if (scope === 'saves' && filter !== 'all') {
      errors.push('filter: a saves feed keeps every saved story.');
    }
  }
  return checked(errors, () => ({
    scope: scope as FeedScope,
    ...(filter !== undefined ? { filter: filter as FeedFilter } : {}),
    ...(typeof tag === 'string' ? { tag: tag.trim() } : {}),
    ...(section !== undefined ? { section_id: section } : {}),
  }));
}

/** A checked email body. */
export interface EmailInput {
  /** One to {@link MAX_RECIPIENTS} addresses. */
  readonly to: readonly string[];
  /** The sender's own note above the story. */
  readonly comment?: string;
  /** Whether the sender gets a copy (true unless they say not). */
  readonly copy_me: boolean;
  /** The name the email goes out under, instead of the account's. */
  readonly from_name?: string;
}

/** Most addresses one story email may go to. */
export const MAX_RECIPIENTS = 10;

/** Longest note a sender may add. */
const MAX_COMMENT_LENGTH = 2048;

/** Whether `value` looks like one email address. */
function isAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value)
  );
}

/**
 * The addresses in `to`: a list, or (as NewsBlur takes them) one string with
 * the addresses separated by commas or spaces. Undefined when it is neither.
 */
function addressesOf(to: unknown): string[] | undefined {
  if (typeof to === 'string') return to.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(to) && to.every((a) => typeof a === 'string')) {
    return (to as string[]).map((a) => a.trim()).filter(Boolean);
  }
  return undefined;
}

/**
 * Check an email body: `to` is one to {@link MAX_RECIPIENTS} addresses (a
 * list, or one string separated by commas or spaces), `comment` an optional
 * note of at most 2,048 characters, `copy_me` an optional boolean, and
 * `from_name` an optional name to send under (NewsBlur asks for one).
 */
export function parseEmailInput(
  body: Readonly<Record<string, unknown>>,
): Checked<EmailInput> {
  const errors = strangers(
    body,
    ['to', 'comment', 'copy_me', 'from_name'],
    'an email',
  );
  const fromName = body['from_name'];
  if (
    fromName !== undefined &&
    (typeof fromName !== 'string' ||
      !fromName.trim() ||
      fromName.length > MAX_NAME_LENGTH ||
      /[<>"\r\n]/.test(fromName))
  ) {
    errors.push('from_name: must be a plain name.');
  }
  const to = addressesOf(body['to']);
  if (!to?.length || to.length > MAX_RECIPIENTS || !to.every(isAddress)) {
    errors.push(`to: must be 1 to ${MAX_RECIPIENTS} email addresses.`);
  }
  const { comment, copy_me: copyMe } = body;
  if (
    comment !== undefined &&
    (typeof comment !== 'string' || comment.length > MAX_COMMENT_LENGTH)
  ) {
    errors.push(
      `comment: must be text of at most ${MAX_COMMENT_LENGTH} characters.`,
    );
  }
  if (copyMe !== undefined && typeof copyMe !== 'boolean') {
    errors.push('copy_me: must be true or false.');
  }
  return checked(errors, () => ({
    to: [...new Set(to)],
    ...(typeof comment === 'string' && comment.trim()
      ? { comment: comment.trim() }
      : {}),
    copy_me: copyMe !== false,
    ...(typeof fromName === 'string' ? { from_name: fromName.trim() } : {}),
  }));
}
