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
        scope_feed_id: null,
        scope_section_id: null,
        is_regex: 0,
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
      is_regex: false,
      created_at: '2026-01-02T03:04:05Z',
    });
  });

  it('shows a negative score as dislike and leaves out an unknown time', () => {
    expect(
      classifierResource({
        id: 3,
        user_id: 9,
        scope_feed_id: null,
        scope_section_id: null,
        is_regex: 0,
        kind: 'tag',
        value: 'x',
        score: -1,
        created_at: null,
      }),
    ).toEqual({
      id: '3',
      kind: 'tag',
      value: 'x',
      score: 'dislike',
      is_regex: false,
    });
  });
});

describe('classifierResource of a super-dislike', () => {
  it('shows a score of -2 as super_dislike', () => {
    expect(
      classifierResource({
        id: 4,
        user_id: 9,
        kind: 'text',
        value: 'x',
        score: -2,
        scope_feed_id: null,
        scope_section_id: null,
        is_regex: 0,
        created_at: null,
      }).score,
    ).toBe('super_dislike');
  });
});

describe('parseClassifierInput', () => {
  it.each([
    ['like', 1],
    ['dislike', -1],
    ['super_dislike', -2],
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
      'kind: must be one of title, author, tag, text, url, feed, source, prompt.',
    ],
    [
      { kind: 'tag', value: ' ', score: 'like' },
      'value: must be a non-blank string.',
    ],
    [
      { kind: 'tag', value: 'x'.repeat(201), score: 'like' },
      'value: too long.',
    ],
    [
      { kind: 'tag', value: 'x', score: 1 },
      'score: must be like, dislike or super_dislike.',
    ],
    [
      { kind: 'feed', value: 'abc', score: 'like' },
      'value: a feed classifier names a feed id.',
    ],
    [
      { kind: 'tag', value: 'x', score: 'like', feed_id: 3 },
      'feed_id: not an id.',
    ],
    [
      { kind: 'tag', value: 'x', score: 'like', section_id: 'x' },
      'section_id: not an id.',
    ],
    [
      { kind: 'tag', value: 'x', score: 'like', feed_id: '1', section_id: '2' },
      'section_id: a classifier is scoped to a feed or a section.',
    ],
    [
      { kind: 'tag', value: 'x', score: 'like', id: '1' },
      'id: not a member of a classifier.',
    ],
  ])('refuses %j', (body, error) => {
    expect(parseClassifierInput(body)).toEqual({ ok: false, errors: [error] });
  });
});

describe('parseClassifierInput scores and scopes', () => {
  it('stores a super dislike as -2', () => {
    expect(
      parseClassifierInput({
        kind: 'url',
        value: 'ads',
        score: 'super_dislike',
      }),
    ).toEqual({ ok: true, input: { kind: 'url', value: 'ads', score: -2 } });
  });

  it.each([
    ['feed_id', 'scope_feed_id'],
    ['section_id', 'scope_section_id'],
  ])('scopes a classifier by %s', (member, stored) => {
    expect(
      parseClassifierInput({
        kind: 'text',
        value: 'x',
        score: 'like',
        [member]: '4',
      }),
    ).toEqual({
      ok: true,
      input: { kind: 'text', value: 'x', score: 1, [stored]: 4 },
    });
  });
});

describe('classifierResource scores and scopes', () => {
  const stored = {
    id: 3,
    user_id: 9,
    kind: 'tag',
    value: 'x',
    score: -2,
    scope_feed_id: 4,
    scope_section_id: null,
    is_regex: 0,
    created_at: null,
  };

  it('shows a score of -2 as super_dislike with its feed scope', () => {
    expect(classifierResource(stored)).toEqual({
      id: '3',
      kind: 'tag',
      value: 'x',
      score: 'super_dislike',
      feed_id: '4',
      is_regex: false,
    });
  });

  it('shows a section scope', () => {
    expect(
      classifierResource({
        ...stored,
        score: 1,
        scope_feed_id: null,
        scope_section_id: 5,
      }),
    ).toMatchObject({ score: 'like', section_id: '5' });
  });
});

describe('regular expressions and prompts', () => {
  it.each(['title', 'author', 'text', 'url'])(
    'takes a regular expression for %s',
    (kind) => {
      expect(
        parseClassifierInput({
          kind,
          value: String.raw`^rust\b`,
          score: 'like',
          is_regex: true,
        }),
      ).toEqual({
        ok: true,
        input: { kind, value: String.raw`^rust\b`, score: 1, is_regex: true },
      });
    },
  );

  it.each([
    [
      { kind: 'tag', value: 'x', score: 'like', is_regex: true },
      'is_regex: only for title, author, text, url.',
    ],
    [
      { kind: 'title', value: 'x', score: 'like', is_regex: 'yes' },
      'is_regex: must be true or false.',
    ],
    [
      { kind: 'title', value: '(', score: 'like', is_regex: true },
      'value: not a valid regular expression.',
    ],
    [
      { kind: 'title', value: '(a+)+', score: 'like', is_regex: true },
      'value: a repeated group may not itself repeat.',
    ],
    [
      { kind: 'prompt', value: 'x', score: 'super_dislike' },
      'score: a prompt classifier is like (focus) or dislike (hidden).',
    ],
    [
      { kind: 'prompt', value: 'x'.repeat(1001), score: 'like' },
      'value: too long.',
    ],
  ])('refuses %j', (body, error) => {
    expect(parseClassifierInput(body)).toEqual({ ok: false, errors: [error] });
  });

  it('takes a prompt of up to 1000 characters', () => {
    expect(
      parseClassifierInput({
        kind: 'prompt',
        value: 'x'.repeat(1000),
        score: 'dislike',
      }),
    ).toMatchObject({ ok: true, input: { kind: 'prompt', score: -1 } });
  });

  it('shows whether a classifier is a regular expression', () => {
    expect(
      classifierResource({
        id: 1,
        user_id: 9,
        kind: 'title',
        value: '^a',
        score: 1,
        scope_feed_id: null,
        scope_section_id: null,
        is_regex: 1,
        created_at: null,
      }).is_regex,
    ).toBe(true);
  });
});
