import { describe, expect, it } from '@jest/globals';

import { AppHeader } from '@/components/site/app-header';
import type { User } from '@/domain/repository';
import { html } from '../render';

const user = (overrides: Partial<User> = {}): User => ({
  id: 1,
  google_sub: 'g1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  picture: null,
  session_epoch: 0,
  created_at: null,
  ...overrides,
});

describe('AppHeader', () => {
  it('offers to sign in when nobody is', () => {
    const out = html(<AppHeader user={null} menu={null} />);
    expect(out).toMatch(/<a class="[^"]*" href="\/login">Sign in<\/a>/);
    expect(out).not.toContain('Sign out');
  });

  it('names the person and lets them sign out', () => {
    const out = html(<AppHeader user={user()} menu={null} />);
    expect(out).toContain('Ada Lovelace');
    expect(out).toMatch(
      /<button type="button" class="[^"]*">Sign out<\/button>/,
    );
    expect(out).not.toContain('href="/login"');
  });

  it('falls back to the email when there is no name', () => {
    expect(
      html(<AppHeader user={user({ name: null })} menu={null} />),
    ).toContain('ada@example.com');
  });

  it('searches the archive with a plain GET form', () => {
    expect(html(<AppHeader user={null} menu={null} />)).toMatch(
      /<form role="search"[^>]*action="\/search" method="get"/,
    );
  });

  it('puts the menu in a drawer for phones', () => {
    const out = html(<AppHeader user={null} menu={<p>the menu</p>} />);
    expect(out).toMatch(
      /<details[^>]*>[\s\S]*Menu[\s\S]*the menu[\s\S]*<\/details>/,
    );
  });
});
