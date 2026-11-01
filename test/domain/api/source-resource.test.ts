import { describe, expect, it } from '@jest/globals';

import { parseSourceQuery, sourceResource } from '@/domain/api/source-resource';
import { encodeCursor } from '@/lib/core/api';

const NOW = new Date('2026-11-01T12:00:00Z');
const parse = (query: string) =>
  parseSourceQuery(new URLSearchParams(query), NOW);

describe('sourceResource', () => {
  const source = {
    id: 4,
    url: 'https://s/rss',
    title: 'S',
    site_url: null,
    followers: 3,
    count: 2,
  };

  it.each([
    ['reads', 'read_count'],
    ['read_time', 'read_seconds'],
    ['follows', 'follow_score'],
  ] as const)('puts the %s count in %s, and nobody who', (order, member) => {
    expect(sourceResource(source, order)).toEqual({
      id: '4',
      url: 'https://s/rss',
      title: 'S',
      followers: 3,
      [member]: 2,
    });
  });
});

describe('parseSourceQuery', () => {
  it('ranks over a week by default, leaving out sources stale for a year', () => {
    expect(parse('order=reads')).toEqual({
      ok: true,
      query: {
        order: 'reads',
        since: '2026-10-25 12:00:00',
        freshSince: '2025-11-01',
        days: 7,
        now: '2026-11-01 12:00:00',
        limit: 20,
      },
    });
  });

  it('reads the count and id from a cursor', () => {
    const cursor = encodeCursor({ key: '5', id: '9' });
    const input = parse(`order=follows&window=month&cursor=${cursor}`);
    expect(input.ok && input.query.after).toEqual({ count: 5, id: 9 });
  });

  it.each([
    ['', 'order: must be one of reads, read_time, follows.'],
    ['order=saves', 'order: must be one of reads, read_time, follows.'],
    ['order=reads&window=year', 'window: must be day, week or month.'],
    ['order=reads&cursor=x', 'cursor: not a cursor of this list.'],
    ['order=reads&limit=0', 'limit: must be a whole number from 1 to 100.'],
    ['order=reads&q=x', 'q: not a parameter of this list.'],
  ])('refuses %s', (query, error) => {
    expect(parse(query)).toEqual({ ok: false, errors: [error] });
  });
});
