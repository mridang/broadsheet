/**
 * @packageDocumentation
 *
 * Feeds on the wire: the representation `/api/feeds` sends, and checking the
 * address a client posts to follow a new one.
 */

import { z } from 'zod';

import {
  iconResource,
  isAutoMarkReadDays,
  parseIcon,
} from '@/domain/api/icon-resource';
import type { IconResource } from '@/domain/api/icon-resource';
import type { Feed, FeedChanges } from '@/domain/repository';
import type { FeedElement } from '@/lib/scraping';

const SQLITE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/iu;
const RFC3339_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/u;
const PARSE_FEED_ID_PATTERN = /^[1-9]\d{0,14}$/u;

/** Longest feed address accepted, in characters. */
export const MAX_FEED_URL_LENGTH = 2048;

/** A feed as the API shows it. Absent members are unknown, never null. */
export interface FeedResource {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly muted: boolean;
  /** When a timed mute runs out; absent when the feed is not muted for a time. */
  readonly muted_until?: string;
  readonly position: number;
  readonly section_id?: string;
  /** Every section the feed is filed in, the one it prints under first. */
  readonly section_ids: readonly string[];
  /** The person's own icon for the feed, when they gave one. */
  readonly custom_icon?: IconResource;
  /** Days until its stories count as read; absent inherits, 0 never. */
  readonly auto_mark_read_days?: number;
  readonly created_at?: string;
  /** What the feed says about itself, from its header; absent until fetched. */
  readonly format?: string;
  readonly site_url?: string;
  readonly description?: string;
  readonly language?: string;
  readonly icon?: string;
  readonly updated_at?: string;
  readonly update_minutes?: number;
  readonly last_fetched_at?: string;
  /** Every element of the feed's header, exactly as the feed gives it. */
  readonly metadata: readonly FeedElement[];
}

/** Whether a list of section ids names no section twice and is short enough. */
const isDistinctSections = (ids: readonly number[]): boolean =>
  new Set(ids).size === ids.length && ids.length <= MAX_FEED_SECTIONS;

/** One element of a feed's header, as it is stored. */
const FEED_ELEMENT: z.ZodType<FeedElement> = z.lazy(() =>
  z.object({
    name: z.string(),
    attributes: z.record(z.string(), z.string()),
    text: z.string(),
    children: z.array(FEED_ELEMENT),
  }),
);

/** The stored header JSON as elements, or none when unreadable. */
function storedHeader(json: string | null): FeedElement[] {
  if (!json) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(json);
    const header = z.array(FEED_ELEMENT).safeParse(parsed);
    return header.success ? header.data : [];
  } catch {
    return [];
  }
}

/** Most sections one feed may be filed in. */
const MAX_FEED_SECTIONS = 50;

/** Highest position a feed may take. */
const MAX_FEED_POSITION = 10_000;

/**
 * An RFC 3339 date-time as SQLite stores times (`YYYY-MM-DD HH:MM:SS`, UTC),
 * or undefined when it is not one.
 */
export function sqliteTime(text: string): string | undefined {
  if (!SQLITE_TIME_PATTERN.test(text)) {
    return undefined;
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms)
    ? undefined
    : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** Longest feed title or section name accepted, in characters. */
export const MAX_NAME_LENGTH = 200;

/**
 * A timestamp from SQLite (`datetime('now')`: UTC as `YYYY-MM-DD HH:MM:SS`) as
 * RFC 3339, or undefined when it is not one.
 */
export function rfc3339(stored: string): string | undefined {
  const match = RFC3339_PATTERN.exec(stored);
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
    ...(feed.muted && feed.muted_until && rfc3339(feed.muted_until)
      ? { muted_until: rfc3339(feed.muted_until) }
      : {}),
    position: feed.position,
    section_ids: feed.section_ids.map(String),
    ...(iconResource(feed.custom_icon)
      ? { custom_icon: iconResource(feed.custom_icon) }
      : {}),
    ...(feed.auto_mark_read_days === null
      ? {}
      : { auto_mark_read_days: feed.auto_mark_read_days }),
    ...(feed.section_id === null
      ? {}
      : { section_id: String(feed.section_id) }),
    ...(created ? { created_at: created } : {}),
    ...(feed.format ? { format: feed.format } : {}),
    ...(feed.site_url ? { site_url: feed.site_url } : {}),
    ...(feed.description ? { description: feed.description } : {}),
    ...(feed.language ? { language: feed.language } : {}),
    ...(feed.icon ? { icon: feed.icon } : {}),
    ...(feed.feed_updated_at ? { updated_at: feed.feed_updated_at } : {}),
    ...(feed.update_minutes ? { update_minutes: feed.update_minutes } : {}),
    ...(feed.last_fetched_at && rfc3339(feed.last_fetched_at)
      ? { last_fetched_at: rfc3339(feed.last_fetched_at) }
      : {}),
    metadata: storedHeader(feed.header),
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
  return PARSE_FEED_ID_PATTERN.test(raw) ? Number(raw) : undefined;
}

/** A checked `PATCH /api/feeds/:id` body, or what was wrong with it. */
export type FeedChangesInput =
  | { readonly ok: true; readonly changes: FeedChanges }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a `PATCH /api/feeds/:id` body: `title` a string or null, `muted` a
 * boolean, `muted_until` an RFC 3339 time or null, `position` a whole number
 * from 0, `section_id` a section id or null. Other members are refused.
 */
export function parseFeedChanges(
  body: Readonly<Record<string, unknown>>,
): FeedChangesInput {
  interface Part {
    readonly changes: FeedChanges;
    readonly errors: readonly string[];
  }
  const notSent: Part = { changes: {}, errors: [] };
  const bad = (...errors: string[]): Part => ({ changes: {}, errors });
  const known = new Set([
    'title',
    'url',
    'muted',
    'muted_until',
    'section_id',
    'section_ids',
    'position',
    'custom_icon',
    'auto_mark_read_days',
  ]);
  const titlePart = (): Part => {
    const title = body['title'];
    if (title === null) {
      return { changes: { title: null }, errors: [] };
    }
    if (typeof title !== 'string') {
      return bad('title: must be a string.');
    }
    if (title.trim().length > MAX_NAME_LENGTH) {
      return bad('title: too long.');
    }
    return { changes: { title: title.trim() || null }, errors: [] };
  };
  const urlPart = (): Part => {
    const address = parseFeedInput({ url: body['url'] });
    return address.ok
      ? { changes: { url: address.url }, errors: [] }
      : bad(...address.errors);
  };
  const mutedPart = (): Part => {
    const muted = body['muted'];
    return typeof muted === 'boolean'
      ? { changes: { muted }, errors: [] }
      : bad('muted: must be true or false.');
  };
  const mutedUntilPart = (): Part => {
    const raw = body['muted_until'];
    if (raw === null) {
      return { changes: { muted_until: null }, errors: [] };
    }
    const at = typeof raw === 'string' ? sqliteTime(raw) : undefined;
    return at === undefined
      ? bad('muted_until: must be an RFC 3339 date-time.')
      : { changes: { muted_until: at }, errors: [] };
  };
  const positionPart = (): Part => {
    const position = body['position'];
    const ok =
      typeof position === 'number' &&
      Number.isInteger(position) &&
      position >= 0 &&
      position <= MAX_FEED_POSITION;
    return ok
      ? { changes: { position }, errors: [] }
      : bad(`position: must be a whole number from 0 to ${MAX_FEED_POSITION}.`);
  };
  const sectionPart = (): Part => {
    const raw = body['section_id'];
    if (raw === null) {
      return { changes: { section_id: null }, errors: [] };
    }
    const id = typeof raw === 'string' ? parseFeedId(raw) : undefined;
    return id === undefined
      ? bad('section_id: not a section id.')
      : { changes: { section_id: id }, errors: [] };
  };
  const sectionsPart = (): Part => {
    if ('section_id' in body) {
      return bad('section_ids: send either section_id or section_ids.');
    }
    const raw = body['section_ids'];
    const parsed = Array.isArray(raw)
      ? raw.map((r) => (typeof r === 'string' ? parseFeedId(r) : undefined))
      : undefined;
    const ids = parsed?.every((id) => id !== undefined) ? parsed : undefined;
    return ids !== undefined && isDistinctSections(ids)
      ? { changes: { section_ids: ids }, errors: [] }
      : bad(
          `section_ids: a list of up to ${MAX_FEED_SECTIONS} different section ids.`,
        );
  };
  const iconPart = (): Part => {
    const icon = parseIcon(body['custom_icon'], 'custom_icon');
    return icon.ok
      ? {
          changes: { custom_icon: icon.icon && JSON.stringify(icon.icon) },
          errors: [],
        }
      : bad(...icon.errors);
  };
  const daysPart = (): Part => {
    const days = body['auto_mark_read_days'];
    return days === null || isAutoMarkReadDays(days)
      ? { changes: { auto_mark_read_days: days }, errors: [] }
      : bad('auto_mark_read_days: a whole number from 0 to 365, or null.');
  };
  const members: readonly (readonly [string, () => Part])[] = [
    ['title', titlePart],
    ['url', urlPart],
    ['muted', mutedPart],
    ['muted_until', mutedUntilPart],
    ['position', positionPart],
    ['section_id', sectionPart],
    ['section_ids', sectionsPart],
    ['custom_icon', iconPart],
    ['auto_mark_read_days', daysPart],
  ];
  const parts: readonly Part[] = [
    {
      changes: {},
      errors: Object.keys(body)
        .filter((key) => !known.has(key))
        .map((key) => `${key}: not a member of a feed that can be changed.`),
    },
    ...members.map(([key, part]) => (key in body ? part() : notSent)),
  ];
  const errors = parts.flatMap((part) => part.errors);
  const changes = Object.fromEntries(
    parts.flatMap((part) => Object.entries(part.changes)),
  ) as FeedChanges;
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changes };
}
