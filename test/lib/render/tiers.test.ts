import { describe, expect, it } from '@jest/globals';

import type { Article } from '../../../src/lib/db';
import { assignTiers, excerpt } from '../../../src/lib/render/tiers';

function article(over: Partial<Article>): Article {
  return {
    id: 1,
    feed_id: 1,
    url: 'https://example.com/a',
    title: 'A',
    source: 'Example',
    image: '',
    favicon: '',
    summary: '',
    published_at: '',
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
