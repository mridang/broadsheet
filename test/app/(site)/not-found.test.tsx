import { describe, expect, it } from '@jest/globals';

import SiteNotFound, { metadata } from '@/app/(site)/not-found';
import { html } from '../../components/render';

const IS_A_LEVEL_ONE_HEADING_PATTERN =
  /<h1[^>]*>We couldn&#x27;t find that page<\/h1>/u;
const OFFERS_THE_WAY_BACK_PATTERN = /href="\/"[^>]*>Back to the front page/u;
const OFFERS_THE_WAY_BACK_PATTERN_2 =
  /href="\/search"[^>]*>Search the archive/u;

describe('SiteNotFound', () => {
  const out = html(<SiteNotFound />);

  it('has a title that says the page was not found, and is not indexed', () => {
    expect(metadata.title).toBe('Page not found');
    expect(metadata.robots).toEqual({ index: false });
  });

  it('is a level-one heading saying so, with no header of its own', () => {
    expect(out).toMatch(IS_A_LEVEL_ONE_HEADING_PATTERN);
    expect(out).not.toContain('<header');
  });

  it('offers the way back to the front page and to search', () => {
    expect(out).toMatch(OFFERS_THE_WAY_BACK_PATTERN);
    expect(out).toMatch(OFFERS_THE_WAY_BACK_PATTERN_2);
  });
});
