/**
 * @packageDocumentation
 *
 * Shared stories on the wire: the representation `/api/shares` and
 * `/api/users/self/shares` send, and checking the body a client posts to
 * share a story. A share names its sharer by id and name, never by email.
 */

import { rfc3339 } from '@/domain/api/feed-resource';
import type { SharedStory } from '@/domain/shares';

/** Longest the comment on a share may be. */
export const MAX_COMMENTS = 5000;

/** A shared story as the API shows it. Absent members are unknown. */
export interface ShareResource {
  readonly id: string;
  readonly article_id: string;
  readonly url: string;
  readonly title?: string;
  readonly source?: string;
  readonly comments?: string;
  readonly shared_at?: string;
  readonly sharer: { readonly id: string; readonly name?: string };
}

/** The API's view of a shared story. */
export function shareResource(share: Readonly<SharedStory>): ShareResource {
  const at = share.shared_at ? rfc3339(share.shared_at) : undefined;
  const { article } = share;
  return {
    id: String(share.id),
    article_id: String(article.id),
    url: article.url,
    ...(article.title ? { title: article.title } : {}),
    ...(article.source ? { source: article.source } : {}),
    ...(share.comments ? { comments: share.comments } : {}),
    ...(at ? { shared_at: at } : {}),
    sharer: {
      id: String(share.sharer.id),
      ...(share.sharer.name ? { name: share.sharer.name } : {}),
    },
  };
}

/** A checked share body: its comment (null for none), or what was wrong. */
export type ShareBody =
  | { readonly ok: true; readonly comments: string | null }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Check the body of a share: an object with at most an optional comment. */
export function parseShareInput(
  body: Readonly<Record<string, unknown>>,
): ShareBody {
  const unknown = Object.keys(body).filter((k) => k !== 'comments');
  if (unknown.length) {
    return { ok: false, errors: unknown.map((k) => `${k}: not allowed.`) };
  }
  const { comments } = body;
  if (comments === undefined || comments === null) {
    return { ok: true, comments: null };
  }
  if (typeof comments !== 'string') {
    return { ok: false, errors: ['comments: must be a string.'] };
  }
  if (comments.length > MAX_COMMENTS) {
    return {
      ok: false,
      errors: [`comments: at most ${MAX_COMMENTS} characters.`],
    };
  }
  return { ok: true, comments: comments.trim() || null };
}

/**
 * The sharer ids a `user_id` query names (repeated or comma separated), or
 * the errors; none means everyone's shares.
 */
export function parseSharerIds(
  raw: readonly string[],
): { ok: true; ids?: number[] } | { ok: false; errors: string[] } {
  const parts = raw.flatMap((r) => r.split(',')).filter(Boolean);
  if (!parts.length) return { ok: true };
  if (parts.length > 100) {
    return { ok: false, errors: ['user_id: at most 100 people.'] };
  }
  const bad = parts.filter((p) => !/^[1-9][0-9]{0,14}$/.test(p));
  if (bad.length) return { ok: false, errors: ['user_id: not an id.'] };
  return { ok: true, ids: [...new Set(parts.map(Number))] };
}
