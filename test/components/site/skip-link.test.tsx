import { describe, expect, it } from '@jest/globals';

import { SkipLink } from '../../../src/components/site/skip-link';
import { html } from '../render';

describe('SkipLink', () => {
  it('jumps to the main landmark', () => {
    const out = html(<SkipLink />);
    expect(out).toContain('href="#main"');
    expect(out).toContain('Skip to content');
  });

  it('stays out of sight until it has focus', () => {
    const out = html(<SkipLink />);
    expect(out).toContain('sr-only');
    expect(out).toContain('focus:not-sr-only');
  });
});
