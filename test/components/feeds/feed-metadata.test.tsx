import { describe, expect, it } from '@jest/globals';

import { FeedMetadata } from '@/components/feeds/feed-metadata';
import { html } from '../render';

describe('FeedMetadata', () => {
  it('shows every element with its label, text, attributes and children', () => {
    const out = html(
      <FeedMetadata
        elements={[
          { name: 'generator', attributes: {}, text: 'Hugo', children: [] },
          {
            name: 'atom:link',
            attributes: { rel: 'self', href: 'https://a.test/f' },
            text: '',
            children: [],
          },
          {
            name: 'image',
            attributes: {},
            text: '',
            children: [
              { name: 'width', attributes: {}, text: '88', children: [] },
            ],
          },
        ]}
      />,
    );
    expect(out).toMatch(/Generator <code[^>]*>generator<\/code>/);
    expect(out).toContain('Hugo');
    expect(out).toMatch(/Link \(Atom\) <code[^>]*>atom:link<\/code>/);
    expect(out).toMatch(/<code[^>]*>rel<\/code> self/);
    expect(out).toContain('href="https://a.test/f"');
    expect(out).toMatch(/Width <code[^>]*>width<\/code>/);
    expect(out).toContain('88');
  });
});
