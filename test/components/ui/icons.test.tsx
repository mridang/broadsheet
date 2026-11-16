import { describe, expect, it } from '@jest/globals';

import { Icon } from '@/components/ui/icons';
import { cssClassesOf, html } from '../render';

const ICON_PATTERN = /<path d="M[^"]+"/;

describe('Icon', () => {
  it.each(['pencil', 'atom', 'rdf', 'rss'] as const)(
    'draws %s as a hidden line in the text colour',
    (name) => {
      const out = html(<Icon name={name} />);
      expect(out).toContain('aria-hidden="true"');
      expect(out).toContain('stroke="currentColor"');
      expect(out).toMatch(ICON_PATTERN);
    },
  );

  it('is size-5 unless given a class', () => {
    expect(cssClassesOf(html(<Icon name="atom" />), 'svg')).toContain('size-5');
    expect(
      cssClassesOf(html(<Icon name="atom" className="size-3" />), 'svg'),
    ).not.toContain('size-5');
  });
});
