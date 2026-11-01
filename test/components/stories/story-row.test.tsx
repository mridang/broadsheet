import { describe, expect, it } from '@jest/globals';

import { StoryRow } from '@/components/stories/story-row';
import { html } from '../render';

describe('StoryRow', () => {
  it('shows where the story is from, its title, excerpt and links', async () => {
    const out = html(
      await StoryRow({
        story: {
          href: '/article/1',
          title: 'A headline',
          meta: ['Source', null, '2026-11-01'],
          excerpt: 'The start of it.',
        },
        children: <a href="https://a.test/">Original</a>,
      }),
    );
    expect(out).toContain('Source · 2026-11-01');
    expect(out).toMatch(/<a href="\/article\/1"[^>]*>A headline<\/a>/);
    expect(out).toContain('The start of it.');
    expect(out).toContain('href="https://a.test/"');
    expect(out).not.toContain('<img');
  });

  it('opens a story on another site in a new tab', async () => {
    const out = html(
      await StoryRow({
        story: {
          href: 'https://a.test/',
          title: 'T',
          meta: [],
          external: true,
        },
      }),
    );
    expect(out).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it('shows its picture through the image proxy', async () => {
    const out = html(
      await StoryRow({
        story: {
          href: '/article/1',
          title: 'T',
          meta: [],
          image: 'https://example.com/p.jpg',
        },
      }),
    );
    expect(out).toMatch(
      /<img src="\/img\?url=https%3A%2F%2Fexample\.com%2Fp\.jpg/,
    );
  });
});
