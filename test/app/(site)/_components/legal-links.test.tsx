import { describe, expect, it } from '@jest/globals';

import { LegalLinks } from '@/app/(site)/_components/legal-links';
import { html } from '../../../components/render';

describe('LegalLinks', () => {
  const out = html(<LegalLinks />);

  it('is a navigation landmark named for what it holds', () => {
    expect(out).toMatch(/^<nav aria-label="Legal"/);
  });

  it('links the privacy policy, then the terms', () => {
    expect(out).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy<\/a>/);
    expect(out).toMatch(/<a [^>]*href="\/terms"[^>]*>Terms<\/a>/);
    expect(out.indexOf('/privacy')).toBeLessThan(out.indexOf('/terms'));
  });
});
