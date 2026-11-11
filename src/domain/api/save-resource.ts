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

/** Longest the notes on a save may be. */
const MAX_NOTES = 5000;

/** Most passages one save may highlight, and the longest one. */
const MAX_HIGHLIGHTS = 50;
const MAX_HIGHLIGHT = 1000;

/** A saved story as the API shows it. Absent members are unknown. */
export interface SaveResource {
  readonly article_id: string;
  readonly url: string;
  readonly title?: string;
  readonly source?: string;
  readonly tags: readonly string[];
  readonly saved_at?: string;
  readonly notes?: string;
  readonly highlights?: readonly string[];
}

/** The API's view of a saved story. */
export function saveResource(story: Readonly<SavedStory>): SaveResource {
  const saved = story.saved_at ? rfc3339(story.saved_at) : undefined;
  const { article, tags, notes, highlights } = story;
  return {
    article_id: String(article.id),
    url: article.url,
    ...(article.title ? { title: article.title } : {}),
    ...(article.source ? { source: article.source } : {}),
    tags,
    ...(saved ? { saved_at: saved } : {}),
    ...(notes ? { notes } : {}),
    ...(highlights?.length ? { highlights } : {}),
  };
}

/**
 * A checked save body: its tags, and its notes and highlights when sent (null
 * notes clear them), or what was wrong with it.
 */
export type SaveBody =
  | {
      readonly ok: true;
      readonly tags: readonly string[];
      readonly notes?: string | null;
      readonly highlights?: readonly string[];
    }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Whether a value is a list of up to `most` non-blank strings of at most `longest`. */
const strings = (raw: unknown, most: number, longest: number): boolean =>
  Array.isArray(raw) &&
  raw.length <= most &&
  raw.every(
    (t) => typeof t === 'string' && t.trim() && t.trim().length <= longest,
  );

/**
 * Check a save body: `tags`, when sent, is a list of up to {@link MAX_TAGS}
 * non-blank strings, trimmed and with repeats dropped; `notes` a string (blank
 * or null clears them); `highlights` a list of passages. Other members are
 * refused.
 */
export function parseSaveInput(
  body: Readonly<Record<string, unknown>>,
): SaveBody {
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (!['tags', 'notes', 'highlights'].includes(key)) {
      errors.push(`${key}: not a member of a save.`);
    }
  }
  const raw = body['tags'] ?? [];
  if (!strings(raw, MAX_TAGS, MAX_TAG_LENGTH)) {
    errors.push(
      `tags: must be a list of up to ${MAX_TAGS} non-blank strings of at most ${MAX_TAG_LENGTH} characters.`,
    );
  }
  const notes = body['notes'];
  if (
    notes !== undefined &&
    notes !== null &&
    (typeof notes !== 'string' || notes.length > MAX_NOTES)
  ) {
    errors.push(`notes: must be a string of at most ${MAX_NOTES} characters.`);
  }
  const highlights = body['highlights'];
  if (
    highlights !== undefined &&
    !strings(highlights, MAX_HIGHLIGHTS, MAX_HIGHLIGHT)
  ) {
    errors.push(
      `highlights: must be a list of up to ${MAX_HIGHLIGHTS} non-blank passages of at most ${MAX_HIGHLIGHT} characters.`,
    );
  }
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        tags: [...new Set((raw as string[]).map((t) => t.trim()))],
        ...(notes === undefined
          ? {}
          : {
              notes: typeof notes === 'string' && notes.trim() ? notes : null,
            }),
        ...(highlights === undefined
          ? {}
          : { highlights: (highlights as string[]).map((h) => h.trim()) }),
      };
}

/** A checked tag rename, or what was wrong with it. */
export type SaveTagBody =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a tag rename: `name` a non-blank string of at most
 * {@link MAX_TAG_LENGTH} characters, trimmed. Other members are refused.
 */
export function parseSaveTagInput(
  body: Readonly<Record<string, unknown>>,
): SaveTagBody {
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (key !== 'name') errors.push(`${key}: not a member of a tag.`);
  }
  const name = body['name'];
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > MAX_TAG_LENGTH
  ) {
    errors.push(
      `name: must be a non-blank string of at most ${MAX_TAG_LENGTH} characters.`,
    );
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, name: (name as string).trim() };
}
