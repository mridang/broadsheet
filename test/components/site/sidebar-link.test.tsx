import { describe, expect, it } from '@jest/globals';

import { SidebarLink } from '@/components/site/sidebar-link';
import { htmlAt } from '../render';

describe('SidebarLink', () => {
  it('is the current page while its address is open', () => {
    expect(
      htmlAt(<SidebarLink href="/saved">Saved</SidebarLink>, {
        pathname: '/saved',
      }),
    ).toContain('aria-current="page" href="/saved"');
  });

  it('is not current on another page', () => {
    expect(
      htmlAt(<SidebarLink href="/saved">Saved</SidebarLink>, {
        pathname: '/search',
      }),
    ).not.toContain('aria-current');
  });

  it('follows what it is told over the address', () => {
    expect(
      htmlAt(
        <SidebarLink href="/feeds/1" current={false}>
          A
        </SidebarLink>,
        { pathname: '/feeds/1' },
      ),
    ).not.toContain('aria-current');
  });
});
