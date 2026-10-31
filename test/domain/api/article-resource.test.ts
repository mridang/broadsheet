import { describe, expect, it } from '@jest/globals';

import {
  articleDetailResource,
  articleResource,
  parseArticleQuery,
} from '@/domain/api/article-resource';
import type { Article } from '@/domain/repository';
import { encodeCursor } from '@/lib/core/api';

const stored: Article = {
  id: 9,
  source_id: 2,
  url: 'https://x/9',
  title: 'Title',
  source: '',
  image: null,
  favicon: '',
  summary: 'Summary',
  published_at: 'Mon, 22 Jun 2026 06:00:00 GMT',
  points: null,
  body_text: 'Text',
  edition: '2026-06-22',
  cluster_id: null,
  fetched_at: null,
};

describe('articleResource', () => {
  it('shows ids as strings, timestamps as RFC 3339 and leaves out the unknown', () => {
    expect(articleResource(stored)).toEqual({
      id: '9',
      url: 'https://x/9',
      title: 'Title',
      summary: 'Summary',
      published_at: '2026-06-22T06:00:00.000Z',
      edition: '2026-06-22',
      points: 0,
    });
  });

  it('drops a publication date that does not parse', () => {
    expect(
      articleResource({ ...stored, published_at: 'soon' }),
    ).not.toHaveProperty('published_at');
  });
});

describe('articleDetailResource', () => {
  it('adds the body text when there is some', () => {
    expect(articleDetailResource(stored).body_text).toBe('Text');
    expect(
      articleDetailResource({ ...stored, body_text: null }),
    ).not.toHaveProperty('body_text');
  });
});

describe('parseArticleQuery', () => {
  const parse = (query: string) =>
    parseArticleQuery(new URLSearchParams(query));

  it('takes the words, a cursor this API issued and a limit', () => {
    const cursor = encodeCursor({ key: '42', id: '42' });
    expect(parse(`q=+rust+&cursor=${cursor}&limit=5`)).toEqual({
      ok: true,
      query: { q: 'rust', before: 42, limit: 5 },
    });
    expect(parse('')).toEqual({
      ok: true,
      query: { q: '', before: undefined, limit: 20 },
    });
  });

  it('names every bad parameter', () => {
    expect(parse(`q=${'a'.repeat(201)}&cursor=nope&limit=0&page=2`)).toEqual({
      ok: false,
      errors: [
        'page: not a parameter of this search.',
        'q: too long.',
        'cursor: not a cursor of this list.',
        'limit: must be a whole number from 1 to 100.',
      ],
    });
  });
});
