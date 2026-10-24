import { describe, expect, it } from '@jest/globals';

import { SiteHeader } from '@/components/site/site-header';
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

describe('SiteHeader signed out', () => {
  const out = html(<SiteHeader user={null} />);

  it('offers to sign in, on the sign-in page', () => {
    expect(out).toMatch(/<a class="navlink" href="\/login">Sign in<\/a>/);
  });

  it('shows the public edition and no account links', () => {
    expect(out).toContain('Hacker News Edition');
    expect(out).not.toContain('Sign out');
    expect(out).not.toContain('Manage feeds');
  });
});

describe('SiteHeader signed in', () => {
  it('greets the person by name, with the feed manager and a way to sign out', () => {
    const out = html(<SiteHeader user={user()} />);
    expect(out).toContain('Personalised Edition');
    expect(out).toContain('Ada Lovelace');
    expect(out).toMatch(/<a class="navlink" href="\/feeds">Manage feeds<\/a>/);
    expect(out).toContain(
      '<button type="button" class="navlink">Sign out</button>',
    );
    expect(out).not.toContain('href="/login"');
    expect(out).not.toContain('/logout');
  });

  it('falls back to the email when there is no name', () => {
    expect(html(<SiteHeader user={user({ name: null })} />)).toContain(
      'ada@example.com',
    );
  });
});
