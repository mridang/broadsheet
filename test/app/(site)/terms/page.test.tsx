import { describe, expect, it } from '@jest/globals';

import TermsPage, { metadata } from '@/app/(site)/terms/page';
import { html } from '../../../components/render';

const HAS_ONE_HEADING_THE_PATTERN = /<h1/gu;
const HAS_ONE_HEADING_THE_PATTERN_2 = /<h1[^>]*>Terms of Service<\/h1>/u;
const LINKS_THE_SOURCE_IN_PATTERN =
  /<a href="https:\/\/github\.com\/mridang\/broadsheet" target="_blank"[^>]*>GitHub<\/a>/u;
const POINTS_TO_THE_PRIVACY_PATTERN =
  /<a [^>]*href="\/privacy"[^>]*>privacy policy<\/a>/u;
const LINKS_BACK_HOME_PATTERN =
  /<a [^>]*href="\/"[^>]*>.*Back to Broadsheet<\/a>/u;

describe('TermsPage', () => {
  const out = html(<TermsPage />);

  it('has one heading, the terms’ title', () => {
    expect(out.match(HAS_ONE_HEADING_THE_PATTERN)).toHaveLength(1);
    expect(out).toMatch(HAS_ONE_HEADING_THE_PATTERN_2);
  });

  it('says when it last changed', () => {
    expect(out).toContain('Last updated: 1 November 2026');
  });

  it('has a section for each part of the terms', () => {
    for (const heading of [
      'Using Broadsheet',
      'The articles',
      'The service',
      'Open source',
      'Your data',
      'Contact',
    ]) {
      expect(out).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`, 'u'));
    }
  });

  it('allows following only feeds people may read', () => {
    expect(out).toContain('Add only feeds you are allowed to read');
  });

  it('says the articles belong to their authors and the service has no warranty', () => {
    expect(out).toContain('belong to their');
    expect(out).toContain('without warranty of any');
  });

  it('links the source in a new tab', () => {
    expect(out).toMatch(LINKS_THE_SOURCE_IN_PATTERN);
  });

  it('points to the privacy policy for data', () => {
    expect(out).toMatch(POINTS_TO_THE_PRIVACY_PATTERN);
  });

  it('gives the contact address', () => {
    expect(out).toContain('mridang.agarwalla@gmail.com');
  });

  it('links back home', () => {
    expect(out).toMatch(LINKS_BACK_HOME_PATTERN);
  });
});

describe('the terms page’s metadata', () => {
  it('may be indexed', () => {
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe('/terms');
  });

  it('has its own social card', () => {
    expect(metadata.openGraph?.url).toBe('/terms');
    expect(metadata.title).toBe('Terms');
    expect(metadata.twitter?.title).toBe('Terms · Broadsheet');
  });
});
