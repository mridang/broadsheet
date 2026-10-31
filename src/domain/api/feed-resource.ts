/**
 * @packageDocumentation
 *
 * Feeds on the wire: the representation `/api/feeds` sends, and checking the
 * address a client posts to follow a new one.
 */

import type { Feed, FeedChanges } from '@/domain/repository';

/** Longest feed address accepted, in characters. */
export const MAX_FEED_URL_LENGTH = 2048;

/** A feed as the API shows it. Absent members are unknown, never null. */
export interface FeedResource {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly muted: boolean;
  readonly section_id?: string;
  readonly created_at?: string;
}

/** Longest feed title or section name accepted, in characters. */
export const MAX_NAME_LENGTH = 200;

/**
 * A timestamp from SQLite (`datetime('now')`: UTC as `YYYY-MM-DD HH:MM:SS`) as
 * RFC 3339, or undefined when it is not one.
 */
export function rfc3339(stored: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(stored);
  if (!match) {
    return undefined;
  }
  const text = `${match[1]}T${match[2]}Z`;
  return Number.isNaN(Date.parse(text)) ? undefined : text;
}

/** The API's view of a stored feed. */
export function feedResource(feed: Readonly<Feed>): FeedResource {
  const created = feed.created_at ? rfc3339(feed.created_at) : undefined;
  return {
    id: String(feed.id),
    url: feed.url,
    ...(feed.title ? { title: feed.title } : {}),
    muted: feed.muted,
    ...(feed.section_id !== null
      ? { section_id: String(feed.section_id) }
      : {}),
    ...(created ? { created_at: created } : {}),
  };
}

/** The checked address of a feed to follow, or what was wrong with it. */
export type FeedInput =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Check the `url` of `POST /api/feeds`: required, an http(s) address, within the limit. */
export function parseFeedInput(
  body: Readonly<Record<string, unknown>>,
): FeedInput {
  const raw = body['url'];
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, errors: ['url: required.'] };
  }
  const url = raw.trim();
  if (url.length > MAX_FEED_URL_LENGTH) {
    return { ok: false, errors: ['url: too long.'] };
  }
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:'
      ? { ok: true, url }
      : { ok: false, errors: ['url: must be an http or https address.'] };
  } catch {
    return { ok: false, errors: ['url: not a valid address.'] };
  }
}

/** The id in a `/api/feeds/:id` path, or undefined when it cannot name a feed. */
export function parseFeedId(raw: string): number | undefined {
  return /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : undefined;
}

/** A checked `PATCH /api/feeds/:id` body, or what was wrong with it. */
export type FeedChangesInput =
  | { readonly ok: true; readonly changes: FeedChanges }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a `PATCH /api/feeds/:id` body: `title` a string or null, `muted` a
 * boolean, `section_id` a section id or null. Other members are refused.
 */
export function parseFeedChanges(
  body: Readonly<Record<string, unknown>>,
): FeedChangesInput {
  const errors: string[] = [];
  const changes: { -readonly [K in keyof FeedChanges]: FeedChanges[K] } = {};
  for (const key of Object.keys(body)) {
    if (!['title', 'muted', 'section_id'].includes(key)) {
      errors.push(`${key}: not a member of a feed that can be changed.`);
    }
  }
  if ('title' in body) {
    const title = body['title'];
    if (title === null) changes.title = null;
    else if (typeof title !== 'string') errors.push('title: must be a string.');
    else if (title.trim().length > MAX_NAME_LENGTH) {
      errors.push('title: too long.');
    } else changes.title = title.trim() || null;
  }
  if ('muted' in body) {
    const muted = body['muted'];
    if (typeof muted === 'boolean') changes.muted = muted;
    else errors.push('muted: must be true or false.');
  }
  if ('section_id' in body) {
    const raw = body['section_id'];
    const id = typeof raw === 'string' ? parseFeedId(raw) : undefined;
    if (raw === null) changes.section_id = null;
    else if (id === undefined) errors.push('section_id: not a section id.');
    else changes.section_id = id;
  }
  return errors.length ? { ok: false, errors } : { ok: true, changes };
}
