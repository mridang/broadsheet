import { describe, expect, it } from '@jest/globals';

import LoginPage, { metadata } from '@/app/(site)/login/page';
import { html } from '../../../components/render';

/** The sign-in page for a visit with the given query string flags. */
async function page(query: { error?: string } = {}): Promise<string> {
  return html(await LoginPage({ searchParams: Promise.resolve(query) }));
}

describe('LoginPage', () => {
  it('is titled Sign in', () => {
    expect(metadata.title).toBe('Sign in');
  });

  it('offers one way in: the Google button, which starts the sign-in flow', async () => {
    const out = await page();
    expect(out).toMatch(
      /<a class="gsi" href="\/auth\/login">[\s\S]*Sign in with Google<\/a>/,
    );
    expect(out.match(/<a /g)).toHaveLength(1);
  });

  it('has no passwordless or email sign-in', async () => {
    const out = await page();
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
    expect(out).not.toContain('/auth/dev');
    expect(out).not.toContain('/auth/google');
  });

  it('says nothing about an error on a plain visit', async () => {
    expect(await page()).not.toContain('did not go through');
  });

  it('says a sign-in did not go through when the callback sent the person back with the flag', async () => {
    expect(await page({ error: 'auth' })).toContain(
      'Signing in did not go through. Please try again.',
    );
  });

  it('ignores any other value of the flag', async () => {
    expect(await page({ error: '<script>' })).not.toContain(
      'did not go through',
    );
  });
});
