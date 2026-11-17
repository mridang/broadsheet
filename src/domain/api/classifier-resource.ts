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
import { isMember } from '@/domain/members';
import { regexProblem } from '@/domain/rules';
import type { Classifier, ClassifierInput } from '@/domain/repository';

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

/** The names of the scores, for checking one. */
const SCORE_NAMES = ['like', 'dislike', 'super_dislike'] as const;

type Score = (typeof SCORE_NAMES)[number];

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
  const mild: ClassifierResource['score'] =
    classifier.score > 0 ? 'like' : 'dislike';
  const score: ClassifierResource['score'] =
    classifier.score <= -2 ? 'super_dislike' : mild;
  return {
    id: String(classifier.id),
    kind: classifier.kind,
    value: classifier.value,
    score,
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
  const { kind, value, score } = body;
  const text = typeof value === 'string' ? value.trim() : '';
  const blank = text === '';
  const tooLong =
    !blank &&
    text.length > (kind === 'prompt' ? MAX_PROMPT_LENGTH : MAX_NAME_LENGTH);
  const valueFine = !blank && !tooLong;
  const badScore = !isMember(SCORE_NAMES, score);
  const regex = body['is_regex'];
  const badRegex = regex !== undefined && typeof regex !== 'boolean';
  const badRegexKind =
    !badRegex && Boolean(regex) && !isMember(REGEX_KINDS, kind);
  const regexFine = !badRegex && !badRegexKind;
  const problem =
    regexFine && regex && typeof value === 'string'
      ? regexProblem(text)
      : undefined;
  const scope = (key: 'feed_id' | 'section_id'): number | undefined => {
    const raw = body[key];
    return typeof raw === 'string' ? parseFeedId(raw) : undefined;
  };
  const feedId = scope('feed_id');
  const sectionId = scope('section_id');
  const errors: string[] = [
    ...Object.keys(body)
      .filter(
        (key) =>
          ![
            'kind',
            'value',
            'score',
            'feed_id',
            'section_id',
            'is_regex',
          ].includes(key),
      )
      .map((key) => `${key}: not a member of a classifier.`),
    ...(isMember(KINDS, kind)
      ? []
      : [`kind: must be one of ${KINDS.join(', ')}.`]),
    ...(blank ? ['value: must be a non-blank string.'] : []),
    ...(tooLong ? ['value: too long.'] : []),
    ...(valueFine && kind === 'feed' && parseFeedId(text) === undefined
      ? ['value: a feed classifier names a feed id.']
      : []),
    ...(badScore ? ['score: must be like, dislike or super_dislike.'] : []),
    ...(!badScore && kind === 'prompt' && score === 'super_dislike'
      ? ['score: a prompt classifier is like (focus) or dislike (hidden).']
      : []),
    ...(badRegex ? ['is_regex: must be true or false.'] : []),
    ...(badRegexKind ? [`is_regex: only for ${REGEX_KINDS.join(', ')}.`] : []),
    ...(problem ? [`value: ${problem}.`] : []),
    ...(body['feed_id'] !== undefined && feedId === undefined
      ? ['feed_id: not an id.']
      : []),
    ...(body['section_id'] !== undefined && sectionId === undefined
      ? ['section_id: not an id.']
      : []),
    ...(feedId !== undefined && sectionId !== undefined
      ? ['section_id: a classifier is scoped to a feed or a section.']
      : []),
  ];
  return errors.length > 0 ||
    typeof kind !== 'string' ||
    !isMember(SCORE_NAMES, score)
    ? { ok: false, errors }
    : {
        ok: true,
        input: {
          kind,
          value: text,
          score: SCORES[score],
          ...(feedId === undefined ? {} : { scope_feed_id: feedId }),
          ...(sectionId === undefined ? {} : { scope_section_id: sectionId }),
          ...(regex ? { is_regex: true } : {}),
        },
      };
}
