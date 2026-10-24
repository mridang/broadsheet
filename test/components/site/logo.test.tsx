import { describe, expect, it } from '@jest/globals';

import { BrandMark } from '@/components/site/logo';
import { classOf, html } from '../render';

describe('BrandMark', () => {
  it('is a decorative drawing in the brand colour, sized by its class', () => {
    const out = html(<BrandMark className="size-14" />);
    expect(out).toContain('aria-hidden="true"');
    expect(classOf(out, 'svg')).toContain('text-brand');
    expect(classOf(out, 'svg')).toContain('size-14');
  });
});
