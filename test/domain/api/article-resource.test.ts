import { describe, expect, it } from '@jest/globals';

import {
  articleDetailResource,
  articleResource,
  parseArticleQuery,
  sqliteSince,
  trendingArticleResource,
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

  it('narrows the list to one feed', () => {
    expect(parse('feed_id=7')).toEqual({
      ok: true,
      query: { q: '', before: undefined, feed: 7, limit: 20 },
    });
  });

  it.each([
    ['feed_id=x', 'feed_id: not a feed id.'],
    ['feed_id=7&order=reads', 'feed_id: not with order reads or saves.'],
  ])('refuses %s', (query, error) => {
    expect(parse(query)).toMatchObject({ ok: false, errors: [error] });
  });

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

describe('parseArticleQuery ranked', () => {
  const NOW = new Date('2026-11-01T12:00:00Z');
  const parse = (query: string) =>
    parseArticleQuery(new URLSearchParams(query), NOW);

  it('ranks by reads over the last week by default', () => {
    expect(parse('order=reads')).toEqual({
      ok: true,
      query: { q: '', limit: 20 },
      trending: { order: 'reads', since: '2026-10-25 12:00:00', limit: 20 },
    });
  });

  it('ranks by saves over the window asked for', () => {
    const input = parse('order=saves&window=day');
    expect(input.ok && input.trending).toMatchObject({
      order: 'saves',
      since: '2026-10-31 12:00:00',
    });
  });

  it('reads the count and id from a ranked cursor', () => {
    const cursor = encodeCursor({ key: '3', id: '12' });
    const input = parse(`order=reads&cursor=${cursor}`);
    expect(input.ok && input.trending?.after).toEqual({ count: 3, id: 12 });
  });

  it.each([
    ['order=popular', 'order: must be newest, reads or saves.'],
    ['order=reads&window=year', 'window: must be day, week or month.'],
    ['window=day', 'window: only with order reads or saves.'],
    ['order=saves&q=rust', 'q: not with order reads or saves.'],
    [
      `order=reads&cursor=${encodeCursor({ key: 'x', id: '3' })}`,
      'cursor: not a cursor of this list.',
    ],
  ])('refuses %s', (query, error) => {
    expect(parse(query)).toEqual({ ok: false, errors: [error] });
  });
});

describe('sqliteSince', () => {
  it('writes the time days ago as SQLite does', () => {
    expect(sqliteSince(new Date('2026-11-01T00:00:00Z'), 30)).toBe(
      '2026-10-02 00:00:00',
    );
  });
});

describe('trendingArticleResource', () => {
  it('shows how many read it, and nobody who did', () => {
    const resource = trendingArticleResource(
      { article: stored, count: 4 },
      'reads',
    );
    expect(resource).toMatchObject({ id: '9', read_count: 4 });
    expect(resource).not.toHaveProperty('save_count');
  });

  it('shows how many saved it for the saves order', () => {
    expect(
      trendingArticleResource({ article: stored, count: 2 }, 'saves'),
    ).toMatchObject({ save_count: 2 });
  });
});
