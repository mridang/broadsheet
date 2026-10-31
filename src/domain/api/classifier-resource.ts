/**
 * @packageDocumentation
 *
 * Classifiers on the wire: the representation `/api/users/self/classifiers`
 * sends, and checking the body a client posts to train the paper.
 */

import { MAX_NAME_LENGTH, rfc3339 } from '@/domain/api/feed-resource';
import type { Classifier, ClassifierInput } from '@/domain/repository';

/** What a classifier can match on. */
const KINDS = ['author', 'source', 'title', 'tag'] as const;

/** What a classifier says about the stories it matches, and its stored score. */
const SCORES = { like: 1, dislike: -1 } as const;

type Score = keyof typeof SCORES;

/** A classifier as the API shows it. */
export interface ClassifierResource {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
  readonly score: Score;
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
    score: classifier.score > 0 ? 'like' : 'dislike',
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked classifier body, or what was wrong with it. */
export type ClassifierBody =
  | { readonly ok: true; readonly input: ClassifierInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a classifier body: `kind` one of author, source, title or tag,
 * `value` a non-blank string, `score` like or dislike. Other members are
 * refused.
 */
export function parseClassifierInput(
  body: Readonly<Record<string, unknown>>,
): ClassifierBody {
  const errors: string[] = [];
  for (const key of Object.keys(body)) {
    if (key !== 'kind' && key !== 'value' && key !== 'score') {
      errors.push(`${key}: not a member of a classifier.`);
    }
  }
  const { kind, value, score } = body;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind))
    errors.push(`kind: must be one of ${KINDS.join(', ')}.`);
  if (typeof value !== 'string' || !value.trim())
    errors.push('value: must be a non-blank string.');
  else if (value.trim().length > MAX_NAME_LENGTH)
    errors.push('value: too long.');
  if (score !== 'like' && score !== 'dislike')
    errors.push('score: must be like or dislike.');
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        input: {
          kind: kind as string,
          value: (value as string).trim(),
          score: SCORES[score as Score],
        },
      };
}
