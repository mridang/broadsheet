import { describe, expect, it } from '@jest/globals';

import { FeedMetadata } from '@/components/feeds/feed-metadata';
import { html } from '../render';

const SHOWS_EVERY_ELEMENT_WITH_PATTERN =
  /Generator <code[^>]*>generator<\/code>/;
const SHOWS_EVERY_ELEMENT_WITH_PATTERN_2 =
  /Link \(Atom\) <code[^>]*>atom:link<\/code>/;
const SHOWS_EVERY_ELEMENT_WITH_PATTERN_3 = /<code[^>]*>rel<\/code> self/;
const SHOWS_EVERY_ELEMENT_WITH_PATTERN_4 = /Width <code[^>]*>width<\/code>/;

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
    expect(out).toMatch(SHOWS_EVERY_ELEMENT_WITH_PATTERN);
    expect(out).toContain('Hugo');
    expect(out).toMatch(SHOWS_EVERY_ELEMENT_WITH_PATTERN_2);
    expect(out).toMatch(SHOWS_EVERY_ELEMENT_WITH_PATTERN_3);
    expect(out).toContain('href="https://a.test/f"');
    expect(out).toMatch(SHOWS_EVERY_ELEMENT_WITH_PATTERN_4);
    expect(out).toContain('88');
  });
});
