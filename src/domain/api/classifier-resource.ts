/**
 * @packageDocumentation
 *
 * Classifiers on the wire: the representation `/api/users/self/classifiers`
 * sends, and checking the body a client posts to train the paper.
 */

import {
  MAX_NAME_LENGTH,
  parseFeedId,
  rfc3339,
} from '@/domain/api/feed-resource';
import type { Classifier, ClassifierInput } from '@/domain/repository';
import { regexProblem } from '@/domain/rules';

/**
 * What a classifier can match on, as NewsBlur's: a phrase in the title, the
 * author, a tag, a phrase in the text, part of the story's address, one of the
 * person's feeds (by id), the site a story is from, or (`prompt`) words the
 * AI judges each story against.
 */
export const KINDS = [
  'title',
  'author',
  'tag',
  'text',
  'url',
  'feed',
  'source',
  'prompt',
] as const;

/** The kinds whose value may be a regular expression, as NewsBlur's. */
const REGEX_KINDS: readonly string[] = ['title', 'author', 'text', 'url'];

/** Longest instruction a `prompt` classifier may give the AI. */
const MAX_PROMPT_LENGTH = 1000;

/** What a classifier says about the stories it matches, and its stored score. */
const SCORES = { like: 1, dislike: -1, super_dislike: -2 } as const;

type Score = keyof typeof SCORES;

/** A classifier as the API shows it. */
export interface ClassifierResource {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
  readonly score: Score;
  /** Only this feed's stories; absent with no `section_id`, everywhere. */
  readonly feed_id?: string;
  /** Only the stories of this section's feeds. */
  readonly section_id?: string;
  /** The value is a regular expression. */
  readonly is_regex: boolean;
  readonly created_at?: string;
}

/** The API's view of a stored classifier. */
export function classifierResource(
  classifier: Readonly<Classifier>,
): ClassifierResource {
  const created = classifier.created_at
    ? rfc3339(classifier.created_at)
    : undefined;
  return {
    id: String(classifier.id),
    kind: classifier.kind,
    value: classifier.value,
    score:
      classifier.score > 0
        ? 'like'
        : classifier.score <= -2
          ? 'super_dislike'
          : 'dislike',
    ...(classifier.scope_feed_id === null
      ? {}
      : { feed_id: String(classifier.scope_feed_id) }),
    ...(classifier.scope_section_id === null
      ? {}
      : { section_id: String(classifier.scope_section_id) }),
    is_regex: classifier.is_regex === 1,
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked classifier body, or what was wrong with it. */
export type ClassifierBody =
  | { readonly ok: true; readonly input: ClassifierInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a classifier body: `kind` one of title, author, tag, text, url, feed
 * or source (a feed one naming a feed id), `score` like, dislike or
 * super_dislike (a prompt only like or dislike), `value` a non-blank string
 * (a prompt up to {@link MAX_PROMPT_LENGTH}), `is_regex` for a title, author,
 * text or url pattern the matcher accepts, and at most one scope, `feed_id`
 * or `section_id`. Other members are refused.
 */
export function parseClassifierInput(
  body: Readonly<Record<string, unknown>>,
): ClassifierBody {
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (
      !['kind', 'value', 'score', 'feed_id', 'section_id', 'is_regex'].includes(
        key,
      )
    ) {
      errors.push(`${key}: not a member of a classifier.`);
    }
  }
  const { kind, value, score } = body;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind))
    errors.push(`kind: must be one of ${KINDS.join(', ')}.`);
  if (typeof value !== 'string' || !value.trim())
    errors.push('value: must be a non-blank string.');
  else if (
    value.trim().length >
    (kind === 'prompt' ? MAX_PROMPT_LENGTH : MAX_NAME_LENGTH)
  )
    errors.push('value: too long.');
  else if (kind === 'feed' && parseFeedId(value.trim()) === undefined)
    errors.push('value: a feed classifier names a feed id.');
  if (typeof score !== 'string' || !Object.hasOwn(SCORES, score))
    errors.push('score: must be like, dislike or super_dislike.');
  else if (kind === 'prompt' && score === 'super_dislike')
    errors.push(
      'score: a prompt classifier is like (focus) or dislike (hidden).',
    );
  const regex = body['is_regex'];
  if (regex !== undefined && typeof regex !== 'boolean')
    errors.push('is_regex: must be true or false.');
  else if (regex && !REGEX_KINDS.includes(kind as string))
    errors.push(`is_regex: only for ${REGEX_KINDS.join(', ')}.`);
  else if (regex && typeof value === 'string') {
    const problem = regexProblem(value.trim());
    if (problem) errors.push(`value: ${problem}.`);
  }
  const scope = (key: 'feed_id' | 'section_id'): number | undefined => {
    const raw = body[key];
    if (raw === undefined) return undefined;
    const id = typeof raw === 'string' ? parseFeedId(raw) : undefined;
    if (id === undefined) errors.push(`${key}: not an id.`);
    return id;
  };
  const feedId = scope('feed_id');
  const sectionId = scope('section_id');
  if (feedId !== undefined && sectionId !== undefined)
    errors.push('section_id: a classifier is scoped to a feed or a section.');
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        input: {
          kind: kind as string,
          value: (value as string).trim(),
          score: SCORES[score as Score],
          ...(feedId === undefined ? {} : { scope_feed_id: feedId }),
          ...(sectionId === undefined ? {} : { scope_section_id: sectionId }),
          ...(regex ? { is_regex: true } : {}),
        },
      };
}
