import { describe, expect, it } from '@jest/globals';

import { AppSidebar } from '@/components/site/app-sidebar';
import type { User } from '@/domain/repository';
import { htmlAt } from '../render';

const user: User = {
  id: 1,
  google_sub: 'g1',
  email: 'ada@example.com',
  name: 'Ada',
  picture: null,
  session_epoch: 0,
  created_at: null,
};

describe('AppSidebar', () => {
  it('lists only the public places to a visitor', () => {
    const out = htmlAt(<AppSidebar user={null} feeds={[]} />);
    expect(out).toContain('href="/search"');
    expect(out).not.toContain('href="/settings"');
    expect(out).not.toContain('Your feeds');
  });

  it('lists every place to a reader and marks the open one', () => {
    const out = htmlAt(<AppSidebar user={user} feeds={[]} />, {
      pathname: '/saved',
    });
    [
      '/',
      '/saved',
      '/search',
      '/assistant',
      '/editions',
      '/feeds',
      '/settings',
    ].forEach((href) => expect(out).toContain(`href="${href}"`));
    expect(out).toContain('aria-current="page" href="/saved"');
  });
});
