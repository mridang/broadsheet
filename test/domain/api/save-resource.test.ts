import { describe, expect, it } from '@jest/globals';

import { parseSaveInput, saveResource } from '@/domain/api/save-resource';
import type { ArticleSummary } from '@/domain/repository';

const article: ArticleSummary = {
  id: 5,
  source_id: 1,
  url: 'https://x/1',
  title: 'One',
  source: 'x',
  image: '',
  favicon: '',
  summary: '',
  published_at: '',
  points: 0,
  edition: '2026-10-20',
  cluster_id: null,
  comments_url: null,
  guid: null,
  original_summary: null,
  fetched_at: '',
};

describe('saveResource', () => {
  it('shows the article id as a string with the tags and save time', () => {
    expect(
      saveResource({ article, tags: ['a'], saved_at: '2026-01-02 03:04:05' }),
    ).toEqual({
      article_id: '5',
      url: 'https://x/1',
      title: 'One',
      source: 'x',
      tags: ['a'],
      saved_at: '2026-01-02T03:04:05Z',
    });
  });

  it('leaves out an unknown title, source and time', () => {
    expect(
      saveResource({
        article: { ...article, title: null, source: '' },
        tags: [],
        saved_at: null,
      }),
    ).toEqual({ article_id: '5', url: 'https://x/1', tags: [] });
  });
});

describe('parseSaveInput', () => {
  it('takes no tags from an empty body', () => {
    expect(parseSaveInput({})).toEqual({ ok: true, tags: [] });
  });

  it('trims the tags and drops repeats', () => {
    expect(parseSaveInput({ tags: [' a', 'a', 'b'] })).toEqual({
      ok: true,
      tags: ['a', 'b'],
    });
  });

  it.each([
    [{ tags: 'a' }],
    [{ tags: [''] }],
    [{ tags: [1] }],
    [{ tags: ['x'.repeat(51)] }],
    [{ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
  ])('refuses %j', (body) => {
    expect(parseSaveInput(body)).toMatchObject({ ok: false });
  });

  it('refuses a member that is not part of a save', () => {
    expect(parseSaveInput({ note: 'x' })).toEqual({
      ok: false,
      errors: ['note: not a member of a save.'],
    });
  });
});

describe('saveResource with notes', () => {
  it('shows the note and highlights only when there are some', () => {
    const article = { id: 1, url: 'https://a.test/1' } as Parameters<
      typeof saveResource
    >[0]['article'];
    expect([
      saveResource({
        article,
        tags: [],
        saved_at: null,
        notes: 'n',
        highlights: ['h'],
      }),
      saveResource({ article, tags: [], saved_at: null, notes: null }),
    ]).toEqual([
      {
        article_id: '1',
        url: 'https://a.test/1',
        tags: [],
        notes: 'n',
        highlights: ['h'],
      },
      { article_id: '1', url: 'https://a.test/1', tags: [] },
    ]);
  });
});
