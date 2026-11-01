import { describe, expect, it } from '@jest/globals';

import {
  distinctStories,
  fetchIntervalMinutes,
  maxAgeMinutes,
  sameStory,
  similarity,
  withJitter,
  type ScrapedItem,
} from '@/lib/scraping';

const item = (over: Partial<ScrapedItem>): ScrapedItem => ({
  url: 'https://x/1',
  title: 'A title',
  source: '',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
  ...over,
});

describe('similarity', () => {
  it('is 1 for the same text and 0 for nothing in common', () => {
    expect(similarity('Rust compiler', 'Rust compiler')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('', '')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
  });

  it('ignores case and runs of spaces', () => {
    expect(similarity('Rust  Compiler', 'rust compiler')).toBe(1);
  });
});

describe('sameStory', () => {
  it('matches the same id, or a near title with the same content', () => {
    expect(
      sameStory(item({ guid: 'g' }), item({ guid: 'g', title: 'X' })),
    ).toBe(true);
    expect(
      sameStory(
        item({ title: 'Rust 1.80 released', summary: 'Long text here.' }),
        item({ title: 'Rust 1.80 released!', summary: 'Long text here.' }),
      ),
    ).toBe(true);
  });

  it('keeps stories with a near title but different content apart', () => {
    expect(
      sameStory(
        item({ title: 'Rust 1.80 released', summary: 'One thing.' }),
        item({ title: 'Rust 1.81 released', summary: 'Quite another.' }),
      ),
    ).toBe(false);
  });
});

describe('distinctStories', () => {
  it('uses the link as the id when every item shares one id', () => {
    const out = distinctStories([
      item({ url: 'https://x/1', guid: 'same', title: 'One', summary: 'a' }),
      item({ url: 'https://x/2', guid: 'same', title: 'Two', summary: 'b' }),
    ]);
    expect(out.map((i) => i.guid)).toEqual(['https://x/1', 'https://x/2']);
  });

  it('uses the publication time when the links collide too', () => {
    const out = distinctStories([
      item({ guid: 'same', title: 'One', summary: 'a', published_at: 't1' }),
      item({ guid: 'same', title: 'Two', summary: 'b', published_at: 't2' }),
    ]);
    expect(out.map((i) => i.guid)).toEqual(['t1']);
  });

  it('keeps the first of each set of the same story', () => {
    const out = distinctStories([
      item({
        url: 'https://x/1',
        guid: 'a',
        title: 'Hello world',
        summary: 'Same body text',
      }),
      item({
        url: 'https://x/2',
        guid: 'b',
        title: 'Hello world!',
        summary: 'Same body text',
      }),
      item({ url: 'https://x/1', guid: 'c', title: 'Other', summary: 'Other' }),
      item({
        url: 'https://x/3',
        guid: 'd',
        title: 'Different',
        summary: 'Else',
      }),
    ]);
    expect(out.map((i) => i.url)).toEqual(['https://x/1', 'https://x/3']);
  });
});

describe('fetchIntervalMinutes', () => {
  it.each([
    [{ storiesLastMonth: 60, subscribers: 12, monthsSinceLastStory: 0 }, 6],
    [{ storiesLastMonth: 60, subscribers: 3, monthsSinceLastStory: 0 }, 15],
    [{ storiesLastMonth: 60, subscribers: 1, monthsSinceLastStory: 0 }, 45],
    [{ storiesLastMonth: 15, subscribers: 2, monthsSinceLastStory: 0 }, 30],
    [{ storiesLastMonth: 15, subscribers: 1, monthsSinceLastStory: 0 }, 180],
    [{ storiesLastMonth: 0, subscribers: 2, monthsSinceLastStory: 0 }, 240],
    [{ storiesLastMonth: 0, subscribers: 0, monthsSinceLastStory: 0 }, 1440],
    [{ storiesLastMonth: 0, subscribers: 0, monthsSinceLastStory: 3 }, 2880],
  ])('schedules %j in %i minutes', (activity, minutes) => {
    expect(fetchIntervalMinutes(activity)).toBe(minutes);
  });

  it.each([
    [{ storiesLastMonth: 0, subscribers: 1, monthsSinceLastStory: 3 }, 30],
    [{ storiesLastMonth: 60, subscribers: 12, monthsSinceLastStory: 0 }, 6],
  ])(
    'fetches %j at least every 30 minutes when notified',
    (activity, minutes) => {
      expect(fetchIntervalMinutes({ ...activity, notified: true })).toBe(
        minutes,
      );
    },
  );
});

describe('withJitter', () => {
  it('adds up to a quarter, or up to double for 5 minutes or less', () => {
    expect(withJitter(240, 0)).toBe(240);
    expect(withJitter(240, 1)).toBe(300);
    expect(withJitter(4, 1)).toBe(8);
  });
});

describe('maxAgeMinutes', () => {
  it('reads max-age in minutes, rounded up', () => {
    expect(maxAgeMinutes('public, max-age=600')).toBe(10);
    expect(maxAgeMinutes('max-age=61')).toBe(2);
  });

  it('is undefined without one', () => {
    expect(maxAgeMinutes('no-cache')).toBeUndefined();
    expect(maxAgeMinutes(null)).toBeUndefined();
    expect(maxAgeMinutes('s-maxage=60')).toBeUndefined();
  });
});
