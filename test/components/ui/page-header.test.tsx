import { describe, expect, it } from '@jest/globals';

import {
  PageHeader,
  PageSection,
  SectionHeader,
} from '@/components/ui/page-header';
import { html } from '../render';

const TITLES_THE_PAGE_WITH_PATTERN = /<h1[^>]*>Your feeds<\/h1>/;
const IS_LABELLED_BY_ITS_PATTERN = /<section aria-labelledby="stories"/;
const IS_LABELLED_BY_ITS_PATTERN_2 = /<h2 id="stories"[^>]*>Stories<\/h2>/;

describe('PageHeader', () => {
  it('titles the page with its description and actions', () => {
    const out = html(
      <PageHeader
        title="Your feeds"
        description="What it is for."
        actions={<button type="button">Go</button>}
      />,
    );
    expect(out).toMatch(TITLES_THE_PAGE_WITH_PATTERN);
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
    expect(out).toMatch(IS_LABELLED_BY_ITS_PATTERN);
    expect(out).toMatch(IS_LABELLED_BY_ITS_PATTERN_2);
  });
});

describe('SectionHeader', () => {
  it('heads a group with its actions beside it', () => {
    const out = html(
      <SectionHeader
        id="s"
        title="Popular"
        actions={<a href="/all">See all</a>}
      />,
    );
    expect(out).toContain('<h2 id="s"');
    expect(out).toContain('See all');
  });

  it('can be a third-level heading', () => {
    expect(html(<SectionHeader as="h3" title="x" />)).toContain('<h3');
  });
});
