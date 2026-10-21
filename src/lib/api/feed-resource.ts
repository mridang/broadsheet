/**
 * @packageDocumentation
 *
 * Feeds on the wire: the representation `/api/feeds` sends, and checking the
 * address a client posts to follow a new one.
 */

import type { Feed } from '../repository';

/** Longest feed address accepted, in characters. */
export const MAX_FEED_URL_LENGTH = 2048;

/** A feed as the API shows it. Absent members are unknown, never null. */
export interface FeedResource {
  readonly id: string;
  readonly url: string;
  readonly title?: string;
  readonly created_at?: string;
}

/** The API's view of a stored feed. */
export function feedResource(feed: Readonly<Feed>): FeedResource {
  return {
    id: String(feed.id),
    url: feed.url,
    ...(feed.title ? { title: feed.title } : {}),
    ...(feed.created_at ? { created_at: feed.created_at } : {}),
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
