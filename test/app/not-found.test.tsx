import { describe, expect, it } from '@jest/globals';

import { NOT_FOUND_LINK, NOT_FOUND_NOTE } from '@/app/_brand';
import NotFound, { metadata } from '@/app/not-found';
import { html } from '../components/render';

const SAYS_THE_PAGE_COULD_PATTERN =
  /<h1[^>]*>We couldn&#x27;t find that page<\/h1>/u;
const OFFERS_A_WAY_BACK_PATTERN =
  /<a [^>]*href="\/"[^>]*>Back to the home page<\/a>/u;

describe('NotFound', () => {
  const out = html(<NotFound />);

  it('says the page could not be found, as the page’s heading', () => {
    expect(out).toMatch(SAYS_THE_PAGE_COULD_PATTERN);
  });

  it('says what may have happened', () => {
    expect(out).toContain(NOT_FOUND_NOTE);
  });

  it('offers a way back home, and the app’s own second way if it has one', () => {
    expect(out).toMatch(OFFERS_A_WAY_BACK_PATTERN);
    for (const link of NOT_FOUND_LINK ? [NOT_FOUND_LINK] : []) {
      expect(out).toContain(`href="${link.href}"`);
      expect(out).toContain(`>${link.label}</a>`);
    }
  });

  it('has a tab title of its own, to which the layout’s template adds the app’s name', () => {
    expect(metadata.title).toBe('Page not found');
  });

  it('asks crawlers not to index it', () => {
    expect(metadata.robots).toEqual({ index: false });
  });
});
