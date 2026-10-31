import { describe, expect, it } from '@jest/globals';

import PrivacyPage, { metadata } from '@/app/(site)/privacy/page';
import { html } from '../../../components/render';

describe('PrivacyPage', () => {
  const out = html(<PrivacyPage />);

  it('has one heading, the policy’s title', () => {
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toMatch(/<h1[^>]*>Privacy Policy<\/h1>/);
  });

  it('says when it last changed', () => {
    expect(out).toContain('Last updated: 1 November 2026');
  });

  it('has a section for each part of the policy', () => {
    for (const heading of [
      'What we access',
      'What we store',
      'Fetching your feeds',
      'Artificial intelligence',
      'Cookies and logs',
      'What we don’t do',
      'Deleting your data',
      'Contact',
    ]) {
      expect(out).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    }
  });

  it('names the only Google scopes signing in asks for', () => {
    for (const scope of ['openid', 'email', 'profile']) {
      expect(out).toContain(
        `<code class="font-mono text-base">${scope}</code>`,
      );
    }
  });

  it('names the session cookie and how long it lasts', () => {
    expect(out).toContain('broadsheet_session');
    expect(out).toContain('lasts up to 30 days');
  });

  it('says which model provider sees article titles, and that nothing about the reader goes with them', () => {
    expect(out).toContain('Cloudflare Workers AI');
    expect(out).toContain('Nothing about you is sent with them');
  });

  it('says how to delete an account and withdraw Google’s permission', () => {
    expect(out).toContain('To delete your account, email us');
    expect(out).toMatch(
      /<a [^>]*href="https:\/\/myaccount\.google\.com\/permissions"[^>]*target="_blank"/,
    );
  });

  it('gives the contact address', () => {
    expect(out).toContain('mridang.agarwalla@gmail.com');
  });

  it('links back home', () => {
    expect(out).toMatch(
      /<a [^>]*href="\/"[^>]*>.*Back to The Hacker Times<\/a>/,
    );
  });
});

describe('the privacy page’s metadata', () => {
  it('may be indexed', () => {
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe('/privacy');
  });

  it('has its own social card', () => {
    expect(metadata.openGraph?.url).toBe('/privacy');
    expect(metadata.title).toBe('Privacy');
    expect(metadata.twitter?.title).toBe('Privacy · The Hacker Times');
  });
});
