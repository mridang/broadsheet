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
import { FEED_FILTERS, FEED_SCOPES, WEBHOOK_EVENTS } from '@/domain/outbound';
import { isMember } from '@/domain/members';
import { isObject } from '@/lib/core/api';
import { isPublicWebUrl } from '@/lib/safe-fetch';
import type {
  FeedFilter,
  FeedScope,
  FeedToken,
  FeedTokenInput,
  PushSubscription,
  PushSubscriptionInput,
  Webhook,
  WebhookEvent,
} from '@/domain/outbound';

const IS_KEY_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/u;
const IS_PLAIN_NAME_PATTERN = /[<>"\r\n]/u;
const ADDRESSES_OF_PATTERN = /[\s,]+/u;
const IS_MAILBOX_PATTERN = /^[^\s@<>,;"]+$/u;

/** A checked body, or what was wrong with it. */
export type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The checked value, or the errors, from a list of errors. */
function checked<T>(errors: readonly string[], value: () => T): Checked<T> {
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value() };
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

/** Whether `value` is an https address on the public web. */
function isPublicHttps(value: string): boolean {
  return value.startsWith('https://') && isPublicWebUrl(value);
}

/** A base64url value of `min` to `max` characters. */
function isKey(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    IS_KEY_PATTERN.test(value)
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
  const { endpoint, keys } = body;
  const pair = isObject(keys) ? keys : {};
  const address =
    typeof endpoint === 'string' && isPublicHttps(endpoint)
      ? endpoint
      : undefined;
  const p256dh = isKey(pair['p256dh'], 80, 100) ? pair['p256dh'] : undefined;
  const auth = isKey(pair['auth'], 16, 32) ? pair['auth'] : undefined;
  const errors = [
    ...strangers(
      body,
      ['endpoint', 'keys', 'expiration_time', 'expirationTime'],
      'a push subscription',
    ),
    ...(address === undefined
      ? ['endpoint: must be a public https address.']
      : []),
    ...(p256dh === undefined
      ? ['keys.p256dh: must be the base64url P-256 public key.']
      : []),
    ...(auth === undefined
      ? ['keys.auth: must be the base64url auth secret.']
      : []),
  ];
  if (
    errors.length > 0 ||
    address === undefined ||
    p256dh === undefined ||
    auth === undefined
  ) {
    return { ok: false, errors };
  }
  return { ok: true, value: { endpoint: address, p256dh, auth } };
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
  const { url, events } = body;
  const address =
    typeof url === 'string' &&
    url.length <= MAX_URL_LENGTH &&
    isPublicHttps(url)
      ? url
      : undefined;
  const wanted =
    Array.isArray(events) &&
    events.length > 0 &&
    events.every((event): event is WebhookEvent =>
      isMember(WEBHOOK_EVENTS, event),
    )
      ? events
      : undefined;
  const errors = [
    ...strangers(body, ['url', 'events'], 'a webhook'),
    ...(address === undefined ? ['url: must be a public https address.'] : []),
    ...(wanted === undefined
      ? [`events: must be a non-empty list of ${WEBHOOK_EVENTS.join(', ')}.`]
      : []),
  ];
  if (errors.length > 0 || address === undefined || wanted === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, value: { url: address, events: [...new Set(wanted)] } };
}

/** A feed token as the API shows it; `token` only in the answer that made it. */
export interface FeedTokenResource {
  readonly id: string;
  readonly scope: FeedScope;
  readonly tag?: string;
  readonly section_id?: string;
  readonly search_id?: string;
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
    ...(row.section_id === null ? {} : { section_id: String(row.section_id) }),
    ...(row.search_id === null ? {} : { search_id: String(row.search_id) }),
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
 * Check a feed token body: `scope` saves, section, edition, search or
 * highlights (the passages the person marked in their saves). `filter` (all,
 * unread or focus) keeps a section or edition feed to stories not disliked or
 * only liked ones, as NewsBlur's folder feeds do. `tag` narrows
 * saves to one tag; `section_id` is required for, and only allowed with, a
 * section; `search_id` likewise for a search, which follows one of the
 * person's saved searches (NewsBlur's saved-search feeds).
 */
export function parseFeedTokenInput(
  body: Readonly<Record<string, unknown>>,
): Checked<FeedTokenInput> {
  const {
    scope,
    tag,
    section_id: sectionId,
    search_id: searchId,
    filter,
  } = body;
  const section =
    typeof sectionId === 'string' ? parseFeedId(sectionId) : undefined;
  const search =
    typeof searchId === 'string' ? parseFeedId(searchId) : undefined;
  const tagBad =
    typeof tag !== 'string' ||
    !tag.trim() ||
    tag.trim().length > MAX_NAME_LENGTH;
  const chosenFilter = isMember(FEED_FILTERS, filter) ? filter : undefined;
  const chosenScope = isMember(FEED_SCOPES, scope) ? scope : undefined;
  const strict = chosenFilter !== undefined && chosenFilter !== 'all';
  const errors = [
    ...strangers(
      body,
      ['scope', 'tag', 'section_id', 'search_id', 'filter'],
      'a feed token',
    ),
    ...(chosenScope === undefined
      ? [`scope: must be one of ${FEED_SCOPES.join(', ')}.`]
      : []),
    ...(tag !== undefined && scope !== 'saves'
      ? ['tag: only for a saves feed.']
      : []),
    ...(tag !== undefined && scope === 'saves' && tagBad
      ? ['tag: must be a non-blank string.']
      : []),
    ...(scope === 'section' && section === undefined
      ? ['section_id: must name one of your sections.']
      : []),
    ...(scope !== 'section' && sectionId !== undefined
      ? ['section_id: only for a section feed.']
      : []),
    ...(scope === 'search' && search === undefined
      ? ['search_id: must name one of your saved searches.']
      : []),
    ...(scope !== 'search' && searchId !== undefined
      ? ['search_id: only for a search feed.']
      : []),
    ...(filter !== undefined && chosenFilter === undefined
      ? [`filter: must be one of ${FEED_FILTERS.join(', ')}.`]
      : []),
    ...(strict && scope === 'saves'
      ? ['filter: a saves feed keeps every saved story.']
      : []),
    ...(strict && scope === 'search'
      ? ['filter: a search feed keeps every story it finds.']
      : []),
    ...(strict && scope === 'highlights'
      ? ['filter: a highlights feed keeps every highlight.']
      : []),
  ];
  if (errors.length > 0 || chosenScope === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      scope: chosenScope,
      ...(chosenFilter === undefined ? {} : { filter: chosenFilter }),
      ...(typeof tag === 'string' ? { tag: tag.trim() } : {}),
      ...(section === undefined ? {} : { section_id: section }),
      ...(search === undefined ? {} : { search_id: search }),
    },
  };
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
  return typeof value === 'string' && value.length <= 254 && isMailbox(value);
}

/** Whether `name` is a plain name an email may be sent under. */
function isPlainName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    name.length <= MAX_NAME_LENGTH &&
    !IS_PLAIN_NAME_PATTERN.test(name)
  );
}

/**
 * The addresses in `to`: a list, or (as NewsBlur takes them) one string with
 * the addresses separated by commas or spaces. Undefined when it is neither.
 */
function addressesOf(to: unknown): string[] | undefined {
  if (typeof to === 'string') {
    return to.split(ADDRESSES_OF_PATTERN).filter(Boolean);
  }
  if (Array.isArray(to) && to.every((a) => typeof a === 'string')) {
    return to.map((a) => a.trim()).filter(Boolean);
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
  const fromName = body['from_name'];
  const to = addressesOf(body['to']);
  const { comment, copy_me: copyMe } = body;
  const errors = [
    ...strangers(body, ['to', 'comment', 'copy_me', 'from_name'], 'an email'),
    ...(fromName !== undefined && !isPlainName(fromName)
      ? ['from_name: must be a plain name.']
      : []),
    ...(!to?.length || to.length > MAX_RECIPIENTS || !to.every(isAddress)
      ? [`to: must be 1 to ${MAX_RECIPIENTS} email addresses.`]
      : []),
    ...(comment !== undefined &&
    (typeof comment !== 'string' || comment.length > MAX_COMMENT_LENGTH)
      ? [`comment: must be text of at most ${MAX_COMMENT_LENGTH} characters.`]
      : []),
    ...(copyMe !== undefined && typeof copyMe !== 'boolean'
      ? ['copy_me: must be true or false.']
      : []),
  ];
  return checked(errors, () => ({
    to: [...new Set(to)],
    ...(typeof comment === 'string' && comment.trim()
      ? { comment: comment.trim() }
      : {}),
    copy_me: copyMe !== false,
    ...(typeof fromName === 'string' ? { from_name: fromName.trim() } : {}),
  }));
}

/** `local@domain.tld` with no space, `@`, `<`, `>`, `,`, `;` or `"` in any part. */
function isMailbox(value: string): boolean {
  const at = value.indexOf('@');
  if (at < 1) {
    return false;
  }
  const domain = value.slice(at + 1);
  return (
    IS_MAILBOX_PATTERN.test(value.slice(0, at)) &&
    IS_MAILBOX_PATTERN.test(domain) &&
    domain.slice(1, -1).includes('.')
  );
}
