import { describe, expect, it } from '@jest/globals';

import {
  MAX_COMMENTS,
  parseShareInput,
  parseSharerIds,
  shareResource,
} from '@/domain/api/share-resource';
import type { SharedStory } from '@/domain/shares';

const share = {
  id: 3,
  article: { id: 9, url: 'https://x/1', title: 'One', source: 'X' },
  comments: 'Good',
  shared_at: '2026-10-20 08:00:00',
  sharer: { id: 7, name: 'Ada' },
} as unknown as SharedStory;

describe('shareResource', () => {
  it('shows the story, the comment and the sharer by id and name', () => {
    expect(shareResource(share)).toEqual({
      id: '3',
      article_id: '9',
      url: 'https://x/1',
      title: 'One',
      source: 'X',
      comments: 'Good',
      shared_at: '2026-10-20T08:00:00Z',
      sharer: { id: '7', name: 'Ada' },
    });
  });

  it('leaves out what is unknown', () => {
    expect(
      shareResource({
        ...share,
        comments: null,
        shared_at: null,
        sharer: { id: 7, name: null },
      }),
    ).not.toHaveProperty('comments');
  });
});

describe('parseShareInput', () => {
  it('takes a trimmed comment, and none for blank or missing', () => {
    expect(parseShareInput({ comments: ' Hi ' })).toEqual({
      ok: true,
      comments: 'Hi',
    });
    expect(parseShareInput({ comments: '  ' })).toEqual({
      ok: true,
      comments: null,
    });
    expect(parseShareInput({})).toEqual({ ok: true, comments: null });
  });

  it.each([
    [{ comments: 1 }, 'comments: must be a string.'],
    [
      { comments: 'x'.repeat(MAX_COMMENTS + 1) },
      `comments: at most ${MAX_COMMENTS} characters.`,
    ],
    [{ note: 'x' }, 'note: not allowed.'],
  ])('refuses %j', (body, error) => {
    expect(parseShareInput(body)).toEqual({ ok: false, errors: [error] });
  });
});

describe('parseSharerIds', () => {
  it('reads repeated and comma separated ids, once each', () => {
    expect(parseSharerIds(['1,2', '2'])).toEqual({ ok: true, ids: [1, 2] });
  });

  it('means everyone when none are given', () => {
    expect(parseSharerIds([])).toEqual({ ok: true });
  });

  it('refuses something that is not an id', () => {
    expect(parseSharerIds(['0'])).toEqual({
      ok: false,
      errors: ['user_id: not an id.'],
    });
  });

  it('refuses more than 100 people', () => {
    const many = Array.from({ length: 101 }, (_, i) => String(i + 1));
    expect(parseSharerIds(many)).toMatchObject({ ok: false });
  });
});
