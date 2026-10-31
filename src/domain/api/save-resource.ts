/**
 * @packageDocumentation
 *
 * Saved stories on the wire: the representation `/api/users/self/saves`
 * sends, and checking the optional body a client posts to save a story.
 */

import { rfc3339 } from '@/domain/api/feed-resource';
import type { SavedStory } from '@/domain/repository';

/** Most tags one save may carry. */
const MAX_TAGS = 20;

/** Longest a tag may be. */
const MAX_TAG_LENGTH = 50;

/** A saved story as the API shows it. Absent members are unknown. */
export interface SaveResource {
  readonly article_id: string;
  readonly url: string;
  readonly title?: string;
  readonly source?: string;
  readonly tags: readonly string[];
  readonly saved_at?: string;
}

/** The API's view of a saved story. */
export function saveResource(story: Readonly<SavedStory>): SaveResource {
  const saved = story.saved_at ? rfc3339(story.saved_at) : undefined;
  const { article } = story;
  return {
    article_id: String(article.id),
    url: article.url,
    ...(article.title ? { title: article.title } : {}),
    ...(article.source ? { source: article.source } : {}),
    tags: story.tags,
    ...(saved ? { saved_at: saved } : {}),
  };
}

/** Checked save tags, or what was wrong with them. */
export type SaveBody =
  | { readonly ok: true; readonly tags: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a save body: `tags`, when sent, is a list of up to {@link MAX_TAGS}
 * non-blank strings, trimmed and with repeats dropped. Other members are
 * refused.
 */
export function parseSaveInput(
  body: Readonly<Record<string, unknown>>,
): SaveBody {
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (key !== 'tags') errors.push(`${key}: not a member of a save.`);
  }
  const raw = body['tags'] ?? [];
  if (
    !Array.isArray(raw) ||
    raw.length > MAX_TAGS ||
    !raw.every(
      (t) =>
        typeof t === 'string' && t.trim() && t.trim().length <= MAX_TAG_LENGTH,
    )
  ) {
    errors.push(
      `tags: must be a list of up to ${MAX_TAGS} non-blank strings of at most ${MAX_TAG_LENGTH} characters.`,
    );
  }
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        tags: [...new Set((raw as string[]).map((t) => t.trim()))],
      };
}
