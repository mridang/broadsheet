import { describe, expect, it } from '@jest/globals';

import PrivacyPage, { metadata } from '@/app/(site)/privacy/page';
import { html } from '../../../components/render';

const HAS_ONE_HEADING_THE_PATTERN = /<h1/gu;
const HAS_ONE_HEADING_THE_PATTERN_2 = /<h1[^>]*>Privacy Policy<\/h1>/u;
const SAYS_HOW_TO_DELETE_PATTERN =
  /<a [^>]*href="https:\/\/myaccount\.google\.com\/permissions"[^>]*target="_blank"/u;
const LINKS_BACK_HOME_PATTERN =
  /<a [^>]*href="\/"[^>]*>.*Back to Broadsheet<\/a>/u;

describe('PrivacyPage', () => {
  const out = html(<PrivacyPage />);

  it('has one heading, the policy’s title', () => {
    expect(out.match(HAS_ONE_HEADING_THE_PATTERN)).toHaveLength(1);
    expect(out).toMatch(HAS_ONE_HEADING_THE_PATTERN_2);
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
      expect(out).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`, 'u'));
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
    expect(out).toMatch(SAYS_HOW_TO_DELETE_PATTERN);
  });

  it('gives the contact address', () => {
    expect(out).toContain('mridang.agarwalla@gmail.com');
  });

  it('links back home', () => {
    expect(out).toMatch(LINKS_BACK_HOME_PATTERN);
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
    expect(metadata.twitter?.title).toBe('Privacy · Broadsheet');
  });
});
