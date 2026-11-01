import { describe, expect, it } from '@jest/globals';

import { Tabs } from '@/components/ui/tabs';
import { htmlAt } from '../render';

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
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('shows a count beside the words', () => {
    expect(out).toMatch(/All<span[^>]*>4<\/span>/);
  });
});
