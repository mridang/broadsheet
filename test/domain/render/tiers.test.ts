import { describe, expect, it } from '@jest/globals';

import type { Article } from '@/domain/repository';
import {
  ago,
  assignTiers,
  coverageBoost,
  excerpt,
  rank,
  shows,
  tagsOf,
  titleHas,
  verdict,
  type Classifiable,
} from '@/domain/render/tiers';

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
    edition: '',
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

describe('excerpt', () => {
  it('returns short strings unchanged', () => {
    expect(excerpt('hello world', 50)).toBe('hello world');
  });

  it('trims to the budget at a word boundary and appends an ellipsis', () => {
    expect(excerpt('hello wonderful world', 8)).toBe('hello…');
  });

  it('treats null as empty', () => {
    expect(excerpt(null, 10)).toBe('');
  });
});

describe('assignTiers', () => {
  const long = 'x'.repeat(400);

  it('promotes the first story to lead when the section is large enough', () => {
    const arts = Array.from({ length: 6 }, (_, i) =>
      article({ id: i + 1, image: 'img', summary: long }),
    );
    expect(assignTiers(arts)[0]).toBe('lead');
  });

  it('does not create a lead in a tiny section', () => {
    const arts = Array.from({ length: 3 }, (_, i) => article({ id: i + 1 }));
    expect(assignTiers(arts).every((t) => t !== 'lead')).toBe(true);
  });

  it('collapses a thin, late story into the In Brief tail', () => {
    const arts = [
      ...Array.from({ length: 5 }, (_, i) =>
        article({ id: i + 1, image: 'img', summary: long }),
      ),
      article({ id: 6, summary: '' }),
    ];
    expect(assignTiers(arts).at(-1)).toBe('brief');
  });
});

describe('verdict', () => {
  const like = (kind: string, value: string) => ({ kind, value, score: 1 });
  const dislike = (kind: string, value: string) => ({ kind, value, score: -1 });

  it.each([
    ['source', 'example'],
    ['title', 'rust'],
    ['author', 'ada'],
    ['tag', 'lang'],
  ])('likes a story whose %s matches %j, ignoring case', (kind, value) => {
    const story = {
      title: 'Why Rust wins',
      source: 'Example',
      author: 'Ada',
      tags: ['Lang'],
    };
    expect(verdict(story, [like(kind, value)])).toBe(1);
  });

  it('is neutral when nothing matches', () => {
    expect(verdict(article({}), [like('title', 'zig')])).toBe(0);
  });

  it('never matches an author or tag the story does not carry', () => {
    expect(
      verdict(article({}), [dislike('author', 'a'), dislike('tag', 'a')]),
    ).toBe(0);
  });

  it('lets a like win over a dislike', () => {
    expect(
      verdict(article({ title: 'Rust' }), [
        dislike('source', 'example'),
        like('title', 'rust'),
      ]),
    ).toBe(1);
  });

  it('dislikes a story only a dislike matches', () => {
    expect(verdict(article({}), [dislike('source', 'example')])).toBe(-1);
  });

  it('likes a story whose summary or text holds a text phrase', () => {
    expect(
      verdict({ title: 'x', source: null, body_text: 'All about WASM' }, [
        like('text', 'wasm'),
      ]),
    ).toBe(1);
  });

  it('likes every story of a feed by its feed id', () => {
    expect(
      verdict({ title: 'x', source: null, feed_id: 7 }, [like('feed', '7')]),
    ).toBe(1);
  });

  it('lets a super-dislike win over a like on the story itself', () => {
    expect(
      verdict(article({ title: 'Rust ads' }), [
        like('title', 'rust'),
        { kind: 'title', value: 'ads', score: -2 },
      ]),
    ).toBe(-2);
  });

  it('lets a like on the story win over a super-dislike of its site', () => {
    expect(
      verdict(article({ title: 'Rust' }), [
        like('title', 'rust'),
        { kind: 'source', value: 'example', score: -2 },
      ]),
    ).toBe(1);
  });

  it('ignores a kind it does not know', () => {
    expect(verdict(article({}), [like('colour', 'example')])).toBe(0);
  });
});

describe('rank', () => {
  it('orders by weight when untrained', () => {
    const low = article({ id: 1, points: 1 });
    const high = article({ id: 2, points: 100 });
    expect(rank([low, high]).map((a) => a.id)).toEqual([2, 1]);
  });

  it('puts a liked story first, ahead of heavier ones', () => {
    const liked = article({ id: 1, title: 'Rust', points: 1 });
    const heavy = article({ id: 2, title: 'Go', points: 100 });
    const training = [{ kind: 'title', value: 'rust', score: 1 }];
    expect(rank([heavy, liked], training).map((a) => a.id)).toEqual([1, 2]);
  });

  it('leaves out a disliked story', () => {
    const gone = article({ id: 1, title: 'Crypto' });
    const kept = article({ id: 2, title: 'Go' });
    const training = [{ kind: 'title', value: 'crypto', score: -1 }];
    expect(rank([gone, kept], training).map((a) => a.id)).toEqual([2]);
  });

  it('raises a story many sources covered above a heavier lone one', () => {
    const covered = article({ id: 1, points: 10, cluster_id: 4 });
    const lone = article({ id: 2, points: 30 });
    const coverage = new Map([[4, 5]]);
    expect(rank([lone, covered], [], coverage).map((a) => a.id)).toEqual([
      1, 2,
    ]);
  });

  it('lets a like win over coverage', () => {
    const covered = article({ id: 1, cluster_id: 4 });
    const liked = article({ id: 2, title: 'Rust' });
    const training = [{ kind: 'title', value: 'rust', score: 1 }];
    expect(
      rank([covered, liked], training, new Map([[4, 9]])).map((a) => a.id),
    ).toEqual([2, 1]);
  });
});

describe('coverageBoost', () => {
  it('adds nothing for a story one source carried', () => {
    expect(coverageBoost(1)).toBe(0);
  });

  it('adds the log of the number of sources', () => {
    expect(coverageBoost(3)).toBeCloseTo(Math.log(3));
  });

  it('treats no sources as one', () => {
    expect(coverageBoost(0)).toBe(0);
  });
});

describe('verdict, as NewsBlur scores', () => {
  const t = (kind: string, value: string, score: number, scope = {}) => ({
    kind,
    value,
    score,
    ...scope,
  });

  it.each<[string, string, Classifiable]>([
    [
      'text',
      'borrow checker',
      { ...article({ summary: 'About the borrow checker' }) },
    ],
    ['text', 'unsafe', article({ body_text: 'Some unsafe code' })],
    ['url', '/rust/', article({ url: 'https://x.test/rust/1' })],
    ['feed', '7', { ...article({}), feed_id: 7 }],
    ['tag', 'rust', article({ tags: '["Rust"]' })],
  ])('likes a story whose %s matches %j', (kind, value, story) => {
    expect(verdict(story, [t(kind, value, 1)])).toBe(1);
  });

  it('lets a super dislike beat a like', () => {
    expect(
      verdict(article({ title: 'Rust ads' }), [
        t('title', 'rust', 1),
        t('title', 'ads', -2),
      ]),
    ).toBe(-2);
  });

  it('lets the story’s own classifiers beat the feed’s', () => {
    expect(
      verdict({ ...article({ title: 'Rust' }), feed_id: 7 }, [
        t('feed', '7', -1),
        t('title', 'rust', 1),
      ]),
    ).toBe(1);
  });

  it('falls back to the feed classifier when nothing else matches', () => {
    expect(
      verdict({ ...article({ title: 'Go' }), feed_id: 7 }, [
        t('feed', '7', -1),
        t('title', 'rust', 1),
      ]),
    ).toBe(-1);
  });

  it('lets a disliked story dislike its liked site', () => {
    expect(
      verdict(article({ title: 'Crypto' }), [
        t('source', 'example', 1),
        t('title', 'crypto', -1),
      ]),
    ).toBe(-1);
  });

  it.each([
    ['its feed', { scope_feed_id: 7 }, { feed_id: 7 }, 1],
    ['another feed', { scope_feed_id: 8 }, { feed_id: 7 }, 0],
    ['its section', { scope_section_id: 3 }, { section_id: 3 }, 1],
    ['another section', { scope_section_id: 4 }, { section_id: 3 }, 0],
    ['an unknown feed', { scope_feed_id: 7 }, {}, 0],
  ])('applies a classifier scoped to %s accordingly', (_, scope, where, v) => {
    expect(
      verdict({ ...article({ title: 'Rust' }), ...where }, [
        t('title', 'rust', 1, scope),
      ]),
    ).toBe(v);
  });
});

describe('titleHas', () => {
  it.each([
    ['Art of war', 'art', true],
    ['The start', 'art', false],
    ['Use C++ today', '++', true],
    ['Big RUST news', 'rust', true],
    [null, 'x', false],
    ['Anything', '', false],
  ])('%j holds %j: %s', (title, phrase, held) => {
    expect(titleHas(title, phrase)).toBe(held);
  });

  it('finds a later match at a word start', () => {
    expect(titleHas('Smart art', 'art')).toBe(true);
  });
});

describe('tagsOf', () => {
  it.each([
    ['["a","b"]', ['a', 'b']],
    [['c'], ['c']],
    ['not json', []],
    ['{"a":1}', []],
    [null, []],
  ])('reads %j as %j', (stored, tags) => {
    expect(tagsOf(stored)).toEqual(tags);
  });
});

describe('shows', () => {
  it.each([
    [1, 'focus', true],
    [0, 'focus', false],
    [0, 'unread', true],
    [-1, 'unread', false],
    [-2, 'all', true],
  ] as const)('a verdict of %d at %s: %s', (v, level, shown) => {
    expect(shows(v, level)).toBe(shown);
  });

  it('defaults to the unread level', () => {
    expect(shows(-1)).toBe(false);
  });
});

describe('rank at a level', () => {
  const liked = article({ id: 1, title: 'Rust' });
  const plain = article({ id: 2, title: 'Go', points: 50 });
  const hated = article({ id: 3, title: 'Crypto', points: 99 });
  const training = [
    { kind: 'title', value: 'rust', score: 1 },
    { kind: 'title', value: 'crypto', score: -1 },
  ];

  it.each([
    ['focus', [1]],
    ['unread', [1, 2]],
    ['all', [1, 2, 3]],
  ] as const)('keeps at %s the stories %j', (level, ids) => {
    expect(
      rank([hated, plain, liked], training, new Map(), level).map((a) => a.id),
    ).toEqual(ids);
  });
});

describe('verdict with regular expressions and AI prompts', () => {
  const re = (kind: string, value: string, score = 1) => ({
    kind,
    value,
    score,
    is_regex: 1,
  });

  it.each<[string, string, Classifiable]>([
    ['title', '^why\\s+rust', article({ title: 'Why  Rust wins' })],
    ['author', '^ada\\b', { ...article({}), author: 'Ada Lovelace' }],
    ['text', 'borrow(ed|ing)', article({ summary: 'Borrowing rules' })],
    ['url', '/rust/\\d+$', article({ url: 'https://x.test/rust/42' })],
  ])('matches a %s pattern %j, ignoring case', (kind, value, story) => {
    expect(verdict(story, [re(kind, value)])).toBe(1);
  });

  it('never matches a pattern that could run without end', () => {
    expect(verdict(article({ title: 'aaaa' }), [re('title', '(a+)+$')])).toBe(
      0,
    );
  });

  it('never matches a pattern on a kind that takes none', () => {
    expect(verdict(article({ tags: '["x"]' }), [re('tag', 'x')])).toBe(0);
  });

  it('lets a matched AI prompt decide over a super-dislike', () => {
    expect(
      verdict({ ...article({ title: 'Ads' }), prompt_ids: new Set([5]) }, [
        { kind: 'title', value: 'ads', score: -2 },
        { kind: 'prompt', value: 'useful', score: 1, id: 5 },
      ]),
    ).toBe(1);
  });

  it('hides a story an AI hide prompt matched', () => {
    expect(
      verdict({ ...article({}), prompt_ids: new Set([6]) }, [
        { kind: 'prompt', value: 'gossip', score: -1, id: 6 },
      ]),
    ).toBe(-1);
  });

  it('leaves a story no prompt matched to the other training', () => {
    expect(
      verdict(article({ title: 'Rust' }), [
        { kind: 'prompt', value: 'gossip', score: -1, id: 6 },
        { kind: 'title', value: 'rust', score: 1 },
      ]),
    ).toBe(1);
  });
});

describe('ago', () => {
  it('says how long ago in words', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(ago(threeHoursAgo)).toBe('3 hours ago');
  });

  it('is empty for a missing or unparseable date', () => {
    expect(ago(null)).toBe('');
    expect(ago('not a date')).toBe('');
  });
});
