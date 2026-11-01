import { describe, expect, it } from '@jest/globals';

import { PageHeader, PageSection } from '@/components/ui/page-header';
import { html } from '../render';

describe('PageHeader', () => {
  it('titles the page with its description and actions', () => {
    const out = html(
      <PageHeader
        title="Your feeds"
        description="What it is for."
        actions={<button type="button">Go</button>}
      />,
    );
    expect(out).toMatch(/<h1[^>]*>Your feeds<\/h1>/);
    expect(out).toContain('What it is for.');
    expect(out).toContain('<button type="button">Go</button>');
  });

  it('leaves out what it is not given', () => {
    const out = html(<PageHeader title="T" />);
    expect(out).not.toContain('<p');
  });
});

describe('PageSection', () => {
  it('is labelled by its own heading', () => {
    const out = html(
      <PageSection id="stories" title="Stories">
        x
      </PageSection>,
    );
    expect(out).toMatch(/<section aria-labelledby="stories"/);
    expect(out).toMatch(/<h2 id="stories"[^>]*>Stories<\/h2>/);
  });
});
