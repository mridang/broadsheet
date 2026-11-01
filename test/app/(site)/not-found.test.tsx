import { describe, expect, it } from '@jest/globals';

import SiteNotFound, { metadata } from '@/app/(site)/not-found';
import { html } from '../../components/render';

describe('SiteNotFound', () => {
  const out = html(<SiteNotFound />);

  it('has a title that says the page was not found, and is not indexed', () => {
    expect(metadata.title).toBe('Page not found');
    expect(metadata.robots).toEqual({ index: false });
  });

  it('is a level-one heading saying so, with no header of its own', () => {
    expect(out).toMatch(/<h1[^>]*>We couldn&#x27;t find that page<\/h1>/);
    expect(out).not.toContain('<header');
  });

  it('offers the way back to the front page and to search', () => {
    expect(out).toMatch(/href="\/"[^>]*>Back to the front page/);
    expect(out).toMatch(/href="\/search"[^>]*>Search the archive/);
  });
});
