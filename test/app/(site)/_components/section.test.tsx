import { describe, expect, it } from '@jest/globals';

import {
  visibleStories,
  type Personal,
} from '@/app/(site)/_components/section';
import type { Article } from '@/domain/repository';
import type { Intelligence } from '@/domain/render/tiers';

const article = (id: number, title: string): Article => ({
  id,
  source_id: 1,
  url: `https://x.test/${id}`,
  title,
  source: 'X',
  image: null,
  favicon: null,
  summary: null,
  published_at: null,
  points: 0,
  body_text: null,
  edition: '2026-11-01',
  cluster_id: null,
  author: null,
  tags: '[]',
  comments_url: null,
  guid: null,
  original_summary: null,
  fetched_at: null,
});

const desk = {
  feed_id: 4,
  title: 'X',
  url: 'https://x.test/rss',
  stories: [1, 2, 3].map((id) => ({
    id,
    tier: 'standard' as const,
    also: [],
  })),
};
const articles = new Map(
  [article(1, 'Rust'), article(2, 'Go'), article(3, 'Crypto')].map((a) => [
    a.id,
    a,
  ]),
);

const reader = (
  level: Intelligence,
  over: Partial<Personal> = {},
): Personal => ({
  training: [
    { kind: 'title', value: 'rust', score: 1 },
    { kind: 'title', value: 'crypto', score: -1 },
  ],
  read: new Set(),
  saved: new Set(),
  level,
  markReadOnOpen: true,
  markReadOnScroll: false,
  prompted: new Map(),
  sections: new Map([[4, 9]]),
  ...over,
});

const ids = (personal?: Personal) =>
  visibleStories(desk, articles, personal).map((s) => s.id);

describe('visibleStories', () => {
  it('prints every story without a reader', () => {
    expect(ids()).toEqual([1, 2, 3]);
  });

  it.each([
    ['focus', [1]],
    ['unread', [1, 2]],
    ['all', [1, 2, 3]],
  ] as const)('prints at %s the stories %j', (level, shown) => {
    expect(ids(reader(level))).toEqual(shown);
  });

  it('matches classifiers scoped to the desk’s feed and section', () => {
    expect(
      ids(
        reader('focus', {
          training: [
            { kind: 'title', value: 'go', score: 1, scope_section_id: 9 },
            { kind: 'title', value: 'rust', score: 1, scope_feed_id: 5 },
          ],
        }),
      ),
    ).toEqual([2]);
  });

  it('skips a laid story whose article is gone', () => {
    expect(visibleStories(desk, new Map(), reader('all'))).toEqual([]);
  });
});

describe('visibleStories and AI prompts', () => {
  it('lets a matched prompt decide over the other training', () => {
    expect(
      ids(
        reader('focus', {
          training: [
            { kind: 'title', value: 'go', score: -1 },
            { kind: 'prompt', value: 'languages', score: 1, id: 5 },
          ],
          prompted: new Map([[2, new Set([5])]]),
        }),
      ),
    ).toEqual([2]);
  });
});
