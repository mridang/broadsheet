import { describe, expect, it } from '@jest/globals';

import {
  classifierResource,
  parseClassifierInput,
} from '@/domain/api/classifier-resource';

describe('classifierResource', () => {
  it('shows a positive score as like, leaving the owner out', () => {
    expect(
      classifierResource({
        id: 3,
        user_id: 9,
        kind: 'source',
        value: 'a.test',
        score: 1,
        created_at: '2026-01-02 03:04:05',
      }),
    ).toEqual({
      id: '3',
      kind: 'source',
      value: 'a.test',
      score: 'like',
      created_at: '2026-01-02T03:04:05Z',
    });
  });

  it('shows a negative score as dislike and leaves out an unknown time', () => {
    expect(
      classifierResource({
        id: 3,
        user_id: 9,
        kind: 'tag',
        value: 'x',
        score: -1,
        created_at: null,
      }),
    ).toEqual({ id: '3', kind: 'tag', value: 'x', score: 'dislike' });
  });
});

describe('parseClassifierInput', () => {
  it.each([
    ['like', 1],
    ['dislike', -1],
  ])('takes a %s and stores it as %d, trimming the value', (score, stored) => {
    expect(
      parseClassifierInput({ kind: 'title', value: ' rust ', score }),
    ).toEqual({
      ok: true,
      input: { kind: 'title', value: 'rust', score: stored },
    });
  });

  it.each([
    [
      { kind: 'colour', value: 'x', score: 'like' },
      'kind: must be one of author, source, title, tag.',
    ],
    [
      { kind: 'tag', value: ' ', score: 'like' },
      'value: must be a non-blank string.',
    ],
    [
      { kind: 'tag', value: 'x'.repeat(201), score: 'like' },
      'value: too long.',
    ],
    [{ kind: 'tag', value: 'x', score: 1 }, 'score: must be like or dislike.'],
    [
      { kind: 'tag', value: 'x', score: 'like', id: '1' },
      'id: not a member of a classifier.',
    ],
  ])('refuses %j', (body, error) => {
    expect(parseClassifierInput(body)).toEqual({ ok: false, errors: [error] });
  });
});
