import { describe, expect, it } from '@jest/globals';

import { BrandMark, Wordmark } from '@/components/site/logo';
import { cssClassesOf, html } from '../render';

const SETS_THE_NAME_BESIDE_PATTERN = /font-serif[^>]*>Broadsheet</;

describe('BrandMark', () => {
  it('is a decorative drawing in the brand colour, sized by its class', () => {
    const out = html(<BrandMark className="size-14" />);
    expect(out).toContain('aria-hidden="true"');
    expect(cssClassesOf(out, 'svg')).toContain('text-brand');
    expect(cssClassesOf(out, 'svg')).toContain('size-14');
  });
});

describe('Wordmark', () => {
  it('sets the name beside the mark', () => {
    const out = html(<Wordmark name="Broadsheet" />);
    expect(out).toContain('<svg');
    expect(out).toMatch(SETS_THE_NAME_BESIDE_PATTERN);
  });
});
