import { describe, expect, it } from '@jest/globals';

import type { Article } from '@/domain/repository';
import {
  assignTiers,
  coverageBoost,
  excerpt,
  rank,
  verdict,
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
