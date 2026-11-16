import { describe, expect, it } from '@jest/globals';

import {
  DiscoverTabs,
  TABS,
  tabOf,
} from '@/app/(site)/discover/_components/discover-tabs';
import { html } from '../../../../components/render';

const MARKS_ONLY_THE_CURRENT_PATTERN = /aria-current="page"/g;
const MARKS_ONLY_THE_CURRENT_PATTERN_2 =
  /aria-current="page"[^>]*href="\/discover\?tab=podcasts"/;

describe('tabOf', () => {
  it.each(TABS.map(([id]) => id))('reads the %s tab', (id) => {
    expect(tabOf(id)).toBe(id);
  });

  it.each([undefined, '', 'toString', 'nope'])(
    'falls back to trending sites for %p',
    (raw) => {
      expect(tabOf(raw)).toBe('sites');
    },
  );
});

describe('DiscoverTabs', () => {
  const out = html(<DiscoverTabs current="podcasts" />);

  it('links each tab to its own address', () => {
    for (const [id, label] of TABS)
      expect(out).toMatch(
        new RegExp(
          String.raw`<a[^>]*href="/discover\?tab=${id}"[^>]*>${label}</a>`,
        ),
      );
  });

  it('marks only the current tab', () => {
    expect(out.match(MARKS_ONLY_THE_CURRENT_PATTERN)).toHaveLength(1);
    expect(out).toMatch(MARKS_ONLY_THE_CURRENT_PATTERN_2);
  });

  it('is a navigation landmark, with no buttons', () => {
    expect(out).toContain('<nav aria-label="Discover"');
    expect(out).not.toContain('<button');
  });
});
