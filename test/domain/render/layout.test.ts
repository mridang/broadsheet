import { describe, expect, it } from '@jest/globals';

import type { Article, Feed } from '@/domain/repository';
import {
  collapseClusters,
  DESK_STORIES,
  layOut,
  parseLayout,
  storyIds,
  topStories,
} from '@/domain/render/layout';

function article(over: Partial<Article>): Article {
  return {
    id: 1,
    source_id: 1,
    url: 'https://example.com/a',
    title: 'A',
    source: 'Example',
    image: '',
    favicon: '',
    summary: '',
    published_at: '',
    points: 0,
    body_text: null,
    edition: '2026-11-01',
    cluster_id: null,
    comments_url: null,
    guid: null,
    original_summary: null,
    author: null,
    tags: '[]',
    fetched_at: '',
    ...over,
  };
}

function feed(id: number, over: Partial<Feed> = {}): Feed {
  return {
    id,
    user_id: 1,
    source_id: id,
    section_id: null,
    url: `https://feed${id}.test/rss`,
    title: `Feed ${id}`,
    muted: false,
    muted_until: null,
    position: 0,
    section_ids: [],
    custom_icon: null,
    auto_mark_read_days: null,
    created_at: null,
    icon: null,
    format: null,
    site_url: null,
    description: null,
    language: null,
    feed_updated_at: null,
    update_minutes: null,
    last_fetched_at: null,
    header: null,
    ...over,
  };
}

describe('collapseClusters', () => {
  it('keeps the weightiest member and names the other sources', () => {
    const a = article({ id: 1, source_id: 1, source: 'A', cluster_id: 9 });
    const b = article({
      id: 2,
      source_id: 2,
      source: 'B',
      cluster_id: 9,
      points: 50,
    });
    const c = article({ id: 3, source_id: 3, source: 'C', cluster_id: 9 });
    const out = collapseClusters([a, b, c]);
    expect([...out.dropped].toSorted()).toEqual([1, 3]);
    expect(out.also.get(2)).toEqual(['A', 'C']);
    expect(out.coverage.get(9)).toBe(3);
  });

  it('keeps the member the reader likes over a weightier one', () => {
    const liked = article({ id: 1, source: 'Liked', cluster_id: 9 });
    const heavy = article({
      id: 2,
      source_id: 2,
      source: 'Heavy',
      cluster_id: 9,
      points: 500,
    });
    const training = [{ kind: 'source', value: 'liked', score: 1 }];
    expect([...collapseClusters([liked, heavy], training).dropped]).toEqual([
      2,
    ]);
  });

  it('leaves a cluster with one member in the paper alone', () => {
    const out = collapseClusters([article({ id: 1, cluster_id: 9 })]);
    expect(out.dropped.size).toBe(0);
    expect(out.also.size).toBe(0);
  });

  it('does not name the kept story’s own source as other coverage', () => {
    const a = article({ id: 1, source: 'Same', cluster_id: 9, points: 5 });
    const b = article({ id: 2, source_id: 2, source: 'Same', cluster_id: 9 });
    expect(collapseClusters([a, b]).also.get(1)).toEqual([]);
  });
});

describe('collapseClusters options', () => {
  const kept = article({
    id: 1,
    source: 'A',
    title: 'Mars rover lands safely on red planet',
    cluster_id: 9,
    points: 50,
  });
  const twin = article({
    id: 2,
    source_id: 2,
    source: 'B',
    url: 'https://b.test/1',
    title: 'Mars rover lands safely on red planet',
    cluster_id: 9,
  });
  const related = article({
    id: 3,
    source_id: 3,
    source: 'C',
    title: 'NASA probe touches down',
    cluster_id: 9,
  });

  it('lists each folded copy with how it matched', () => {
    expect(collapseClusters([kept, twin, related]).siblings.get(1)).toEqual([
      { id: 2, source: 'B', url: 'https://b.test/1', tier: 'title' },
      { id: 3, source: 'C', url: 'https://example.com/a', tier: 'related' },
    ]);
  });

  it('folds only matching headlines in title mode', () => {
    const out = collapseClusters([kept, twin, related], [], undefined, {
      mode: 'title',
    });
    expect([...out.dropped]).toEqual([2]);
    expect(out.coverage.get(9)).toBe(2);
  });

  it('folds nothing with clustering off', () => {
    const out = collapseClusters([kept, twin], [], undefined, {
      clustering: false,
    });
    expect(out.dropped.size).toBe(0);
  });

  it('prints a same-source copy only the meaning joined on its own', () => {
    const own = article({
      id: 4,
      source: 'A',
      title: 'Space agency celebrates',
      cluster_id: 9,
    });
    expect(collapseClusters([kept, own]).dropped.has(4)).toBe(false);
  });

  it('folds a same-source copy with the same headline', () => {
    const own = article({
      id: 4,
      title: 'Mars rover lands safely on red planet',
      cluster_id: 9,
    });
    expect(collapseClusters([kept, own]).dropped.has(4)).toBe(true);
  });
});

describe('layOut', () => {
  it('keeps a covered story whose heavier copy its desk has no room for', () => {
    const crowd = Array.from({ length: DESK_STORIES }, (_, i) =>
      article({ id: 100 + i, points: 1000 }),
    );
    const heavy = article({ id: 1, points: 100, cluster_id: 9 });
    const light = article({ id: 2, source_id: 2, points: 1, cluster_id: 9 });
    const layout = layOut([
      {
        name: null,
        desks: [
          { feed: feed(1), articles: [...crowd, heavy] },
          { feed: feed(2), articles: [light] },
        ],
      },
    ]);
    expect(storyIds(layout)).toContain(2);
  });

  it(`prints at most ${DESK_STORIES} stories from one feed`, () => {
    const many = Array.from({ length: DESK_STORIES + 5 }, (_, i) =>
      article({ id: i + 1 }),
    );
    const layout = layOut([
      { name: null, desks: [{ feed: feed(1), articles: many }] },
    ]);
    expect(storyIds(layout)).toHaveLength(DESK_STORIES);
  });

  it('prints a story many desks covered once, with the others named', () => {
    const layout = layOut([
      {
        name: null,
        desks: [
          {
            feed: feed(1),
            articles: [article({ id: 1, source: 'A', cluster_id: 9 })],
          },
          {
            feed: feed(2),
            articles: [
              article({
                id: 2,
                source_id: 2,
                source: 'B',
                cluster_id: 9,
                points: 9,
              }),
            ],
          },
        ],
      },
    ]);
    expect(storyIds(layout)).toEqual([2]);
    expect(layout.groups[0]?.desks[1]?.stories[0]?.also).toEqual(['A']);
    expect(layout.groups[0]?.desks[0]?.stories).toEqual([]);
  });

  it('names a desk after its feed, else its host', () => {
    const layout = layOut([
      {
        name: 'Tech',
        desks: [{ feed: feed(1, { title: null }), articles: [] }],
      },
    ]);
    expect(layout.groups[0]).toMatchObject({
      name: 'Tech',
      desks: [{ feed_id: 1, title: 'feed1.test' }],
    });
  });

  it('gives every story a tier', () => {
    const arts = [1, 2, 3, 4, 5].map((id) => article({ id, points: id }));
    const layout = layOut([
      { name: null, desks: [{ feed: feed(1), articles: arts }] },
    ]);
    expect(layout.groups[0]?.desks[0]?.stories[0]).toMatchObject({
      id: 5,
      tier: 'lead',
    });
  });
});

describe('topStories', () => {
  it('takes each desk’s first story, up to the limit', () => {
    const layout = layOut([
      {
        name: null,
        desks: [1, 2, 3].map((n) => ({
          feed: feed(n),
          articles: [
            article({ id: n * 10, source_id: n }),
            article({ id: n * 10 + 1, source_id: n }),
          ],
        })),
      },
    ]);
    expect(topStories(layout, 2)).toHaveLength(2);
    expect(topStories(layout, 2).every((id) => id % 10 === 0)).toBe(true);
  });
});

describe('parseLayout', () => {
  it('reads back a stored layout', () => {
    const layout = layOut([
      { name: null, desks: [{ feed: feed(1), articles: [article({})] }] },
    ]);
    expect(parseLayout(JSON.stringify(layout))).toEqual(layout);
  });

  it.each([
    ['not JSON', '{'],
    ['no groups', '{}'],
    [
      'a bad tier',
      '{"groups":[{"name":null,"desks":[{"feed_id":1,"title":"t","url":"u","stories":[{"id":1,"tier":"huge","also":[]}]}]}]}',
    ],
    ['null', 'null'],
    [
      'a bad copy',
      '{"groups":[{"name":null,"desks":[{"feed_id":1,"title":"t","url":"u","stories":[{"id":1,"tier":"lead","also":[],"siblings":[{"id":2,"source":"s","url":"u","tier":"near"}]}]}]}]}',
    ],
  ])('refuses %s', (_name, stored) => {
    expect(parseLayout(stored)).toBeUndefined();
  });
});

describe('layOut and training', () => {
  const desk = (f: Feed, ids: number[]) => ({
    name: null,
    desks: [{ feed: f, articles: ids.map((id) => article({ id })) }],
  });

  it('keeps disliked stories, last, so any level can be printed', () => {
    const layout = layOut(
      [desk(feed(1), [1, 2])],
      [{ kind: 'url', value: 'example.com/a', score: -1 }],
    );
    expect(storyIds(layout)).toHaveLength(2);
  });

  it('matches a feed classifier against the desk’s feed', () => {
    const layout = layOut(
      [
        {
          name: null,
          desks: [
            {
              feed: feed(1),
              articles: [article({ id: 1, points: 99, cluster_id: 5 })],
            },
            {
              feed: feed(2),
              articles: [article({ id: 2, source_id: 2, cluster_id: 5 })],
            },
          ],
        },
      ],
      [{ kind: 'feed', value: '2', score: 1 }],
    );
    expect(storyIds(layout)).toEqual([2]);
  });

  it('applies a section-scoped classifier to the feeds filed there', () => {
    const liked = layOut(
      [
        {
          name: 'S',
          desks: [
            {
              feed: feed(1, { section_id: 3 }),
              articles: [
                article({ id: 1, points: 99, title: 'Go' }),
                article({ id: 2, title: 'Rust' }),
              ],
            },
          ],
        },
      ],
      [{ kind: 'title', value: 'rust', score: 1, scope_section_id: 3 }],
    );
    expect(storyIds(liked)).toEqual([2, 1]);
  });
});
