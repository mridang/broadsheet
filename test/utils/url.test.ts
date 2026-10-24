import { describe, expect, it } from '@jest/globals';

import { parseUrl } from '@/utils/url';

describe('parseUrl', () => {
  it('parses an absolute URL', () => {
    expect(parseUrl('https://example.com/a?b=1')?.pathname).toBe('/a');
  });

  it('resolves a relative URL against a base', () => {
    expect(parseUrl('/a', 'https://example.com')?.href).toBe(
      'https://example.com/a',
    );
  });

  it('is undefined for text that is not a URL', () => {
    expect(parseUrl('not a url')).toBeUndefined();
    expect(parseUrl('/relative', 'also not a url')).toBeUndefined();
  });
});
