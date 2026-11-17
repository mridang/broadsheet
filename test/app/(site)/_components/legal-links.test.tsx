import { describe, expect, it } from '@jest/globals';

import { LegalLinks } from '@/app/(site)/_components/legal-links';
import { html } from '../../../components/render';

const IS_A_NAVIGATION_LANDMARK_PATTERN = /^<nav aria-label="Legal"/u;
const LINKS_THE_PRIVACY_POLICY_PATTERN =
  /<a [^>]*href="\/privacy"[^>]*>Privacy<\/a>/u;
const LINKS_THE_PRIVACY_POLICY_PATTERN_2 =
  /<a [^>]*href="\/terms"[^>]*>Terms<\/a>/u;

describe('LegalLinks', () => {
  const out = html(<LegalLinks />);

  it('is a navigation landmark named for what it holds', () => {
    expect(out).toMatch(IS_A_NAVIGATION_LANDMARK_PATTERN);
  });

  it('links the privacy policy, then the terms', () => {
    expect(out).toMatch(LINKS_THE_PRIVACY_POLICY_PATTERN);
    expect(out).toMatch(LINKS_THE_PRIVACY_POLICY_PATTERN_2);
    expect(out.indexOf('/privacy')).toBeLessThan(out.indexOf('/terms'));
  });
});
