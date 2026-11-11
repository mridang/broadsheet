import { describe, expect, it } from '@jest/globals';

import {
  byRank,
  capSourceShare,
  decayWeight,
  diversify,
  domainOf,
  neededSeconds,
  rank,
  titleKey,
  topicOf,
  type Candidate,
} from '@/domain/trending';

const activity = (seconds: number[], savers = 0, words = 0) => ({
  id: 1,
  seconds,
  savers,
  words,
});

describe('rank', () => {
  it('ranks well read by readers, then seconds, from two readers', () => {
    expect(rank('reads', activity([5]))).toBeUndefined();
    expect(rank('reads', activity([5, 9999]))).toEqual({
      id: 1,
      count: 2,
      keys: [2, 1205],
    });
  });

  it('ranks read time by seconds of reads of three seconds or more', () => {
    expect(rank('read_time', activity([2, 40]))).toBeUndefined();
    expect(rank('read_time', activity([3, 40, 1]))).toMatchObject({
      count: 43,
    });
  });

  it('ranks long reads by the second-deepest read of a long story', () => {
    expect(rank('long_reads', activity([300, 300], 0, 599))).toBeUndefined();
    expect(rank('long_reads', activity([300, 44, 46], 0, 700))).toEqual({
      id: 1,
      count: 2,
      keys: [46, 2],
    });
  });

  it('ranks good reads with a save first, or four deep readers', () => {
    expect(rank('good_reads', activity([30, 30], 0, 300))).toBeUndefined();
    expect(rank('good_reads', activity([30, 31], 1, 300))?.keys).toEqual([
      1, 30, 2,
    ]);
    expect(
      rank('good_reads', activity([30, 30, 30, 30], 0, 300))?.keys,
    ).toEqual([0, 30, 4]);
    expect(rank('good_reads', activity([30, 30], 1, 249))).toBeUndefined();
  });

  it('ranks saves by savers, from two', () => {
    expect(rank('saves', activity([], 1))).toBeUndefined();
    expect(rank('saves', activity([], 2))).toMatchObject({ count: 2 });
  });
});

describe('byRank', () => {
  it('sorts by each key, then the newer story', () => {
    const list = [
      { id: 1, count: 2, keys: [2, 10] },
      { id: 2, count: 2, keys: [2, 10] },
      { id: 3, count: 3, keys: [3, 0] },
    ];
    expect(list.toSorted(byRank).map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe('neededSeconds', () => {
  it('asks a quarter of the reading time, from 45 seconds to 3 minutes', () => {
    expect(neededSeconds(600)).toBe(45);
    expect(neededSeconds(2400)).toBe(150);
    expect(neededSeconds(100_000)).toBe(180);
  });
});

describe('titleKey, domainOf and topicOf', () => {
  it('folds a title, a site and a topic as NewsBlur does', () => {
    expect(titleKey(' Anthropic-backed  AI: news! ')).toBe(
      'anthropic backed ai news',
    );
    expect(domainOf('https://www.Example.com/feed')).toBe('example.com');
    expect(domainOf('example.org/rss')).toBe('example.org');
    expect(domainOf('::')).toBe('');
    expect(topicOf('New AI software')).toBe('technology');
    expect(topicOf('A quiet day')).toBe('other');
  });
});

const candidate = (id: number, over: Partial<Candidate> = {}): Candidate => ({
  id,
  source: id,
  domain: `s${id}.test`,
  publisher: `s${id}`,
  topic: 'other',
  cluster: null,
  title: `t${id}`,
  followers: 100,
  ...over,
});

describe('diversify', () => {
  it('defers a second story from the same feed to the next block', () => {
    const list = [
      candidate(1, { source: 9 }),
      candidate(2, { source: 9 }),
      candidate(3),
    ];
    expect(diversify(list).map((c) => c.id)).toEqual([1, 3, 2]);
  });

  it('shows the same story (cluster or title) once', () => {
    const list = [
      candidate(1, { cluster: 5 }),
      candidate(2, { cluster: 5 }),
      candidate(3, { title: 't1' }),
    ];
    expect(diversify(list).map((c) => c.id)).toEqual([1]);
  });

  it('takes at most three of a topic in a block', () => {
    const list = [1, 2, 3, 4, 5].map((id) =>
      candidate(id, { topic: 'technology' }),
    );
    expect(diversify(list).map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
    const block = diversify([...list, candidate(6)]).slice(0, 4);
    expect(block.map((c) => c.id)).toEqual([1, 2, 3, 6]);
  });

  it('leads a block with small feeds when given slots', () => {
    const list = [candidate(1), candidate(2, { followers: 10 })];
    expect(diversify(list, 4).map((c) => c.id)).toEqual([2, 1]);
  });
});

describe('capSourceShare', () => {
  it('keeps a source to a tenth of a list of ten or more', () => {
    const list = [
      ...Array.from({ length: 3 }, (_, i) =>
        candidate(i + 1, { domain: 'big.test' }),
      ),
      ...Array.from({ length: 9 }, (_, i) => candidate(i + 10)),
    ];
    const capped = capSourceShare(list);
    expect(capped.filter((c) => c.domain === 'big.test')).toHaveLength(1);
    expect(capSourceShare(list.slice(0, 5))).toHaveLength(5);
  });
});

describe('decayWeight', () => {
  it('weighs follows by age as NewsBlur’s tables do', () => {
    expect(decayWeight(7, 0)).toBe(1);
    expect(decayWeight(7, 6)).toBeCloseTo(0.2, 10);
    expect(decayWeight(7, 7)).toBe(0);
    expect(decayWeight(30, 29)).toBeCloseTo(0.03, 10);
    expect(decayWeight(1, 0)).toBe(1);
    expect(decayWeight(14, 13)).toBeCloseTo(0.03);
    expect(decayWeight(14, 20)).toBe(0);
  });
});
