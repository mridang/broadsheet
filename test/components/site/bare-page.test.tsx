import { describe, expect, it } from '@jest/globals';

import { BRAND_NAME } from '@/app/_brand';
import { BarePage, MessagePage } from '@/components/site/bare-page';
import { html } from '../render';

describe('BarePage', () => {
  it('brings its own main landmark and a wordmark that links home', () => {
    const out = html(<BarePage>hello</BarePage>);
    expect(out).toContain('<main id="main"');
    expect(out).toContain('href="/"');
    expect(out).toContain(BRAND_NAME);
    expect(out).toContain('hello');
  });

  it('starts with a skip link to the main landmark', () => {
    expect(html(<BarePage>x</BarePage>)).toMatch(
      /^<div[^>]*><a href="#main"[^>]*>Skip to content<\/a>/,
    );
  });
});

describe('MessagePage', () => {
  it('has the page heading, the explanation and the actions', () => {
    const out = html(
      <MessagePage
        eyebrow="Page not found"
        title="We couldn't find that page"
        actions={<a href="/">Home</a>}
      >
        <p>It may have moved.</p>
      </MessagePage>,
    );
    expect(out).toMatch(/<h1[^>]*>We couldn&#x27;t find that page<\/h1>/);
    expect(out).toContain('Page not found');
    expect(out).toContain('It may have moved.');
    expect(out).toContain('href="/"');
  });
});
