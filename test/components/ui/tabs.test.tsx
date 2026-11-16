import { describe, expect, it } from '@jest/globals';

import { Tabs } from '@/components/ui/tabs';
import { htmlAt } from '../render';

const MARKS_ONLY_THE_OPEN_PATTERN = /aria-current="page"/g;
const SHOWS_A_COUNT_BESIDE_PATTERN = /All<span[^>]*>4<\/span>/;

describe('Tabs', () => {
  const out = htmlAt(
    <Tabs
      label="Views"
      tabs={[
        { label: 'All', href: '/x', current: true, count: 4 },
        { label: 'Mine', href: '/x?mine=1' },
      ]}
    />,
  );

  it('is a labelled list of links', () => {
    expect(out).toContain('aria-label="Views"');
    expect(out).toContain('href="/x?mine=1"');
  });

  it('marks only the open tab as the current page', () => {
    expect(out.match(MARKS_ONLY_THE_OPEN_PATTERN)).toHaveLength(1);
  });

  it('shows a count beside the words', () => {
    expect(out).toMatch(SHOWS_A_COUNT_BESIDE_PATTERN);
  });
});
