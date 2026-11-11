import { describe, expect, it } from '@jest/globals';

import {
  DiscoverTabs,
  TABS,
  tabOf,
} from '@/app/(site)/discover/_components/discover-tabs';
import { html } from '../../../../components/render';

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
    TABS.forEach(([id, label]) =>
      expect(out).toMatch(
        new RegExp(
          String.raw`<a[^>]*href="/discover\?tab=${id}"[^>]*>${label}</a>`,
        ),
      ),
    );
  });

  it('marks only the current tab', () => {
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(
      /aria-current="page"[^>]*href="\/discover\?tab=podcasts"/,
    );
  });

  it('is a navigation landmark, with no buttons', () => {
    expect(out).toContain('<nav aria-label="Discover"');
    expect(out).not.toContain('<button');
  });
});
