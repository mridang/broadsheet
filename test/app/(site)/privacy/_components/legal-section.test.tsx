import { describe, expect, it } from '@jest/globals';

import { BRAND_NAME } from '@/app/_brand';
import {
  LegalCode,
  LegalItem,
  LegalLink,
  LegalPage,
  LegalSection,
  longDate,
} from '@/app/(site)/privacy/_components/legal-section';
import { classOf, html } from '../../../../components/render';

describe('longDate', () => {
  it('writes an ISO day as day, month name and year', () => {
    expect(longDate('2026-11-01')).toBe('1 November 2026');
  });

  it('reads the day in UTC, so it never slips to the day before', () => {
    expect(longDate('2026-01-01')).toBe('1 January 2026');
  });
});

describe('LegalPage', () => {
  const out = html(
    <LegalPage eyebrow="Privacy" title="Privacy Policy" updated="2026-11-01">
      <p>The body.</p>
    </LegalPage>,
  );

  it('heads the page with its eyebrow and its one title', () => {
    expect(out).toContain('Privacy');
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toMatch(/<h1[^>]*>Privacy Policy<\/h1>/);
  });

  it('says when the page last changed', () => {
    expect(out).toContain('Last updated: 1 November 2026');
  });

  it('puts the body after the title', () => {
    expect(out.indexOf('Privacy Policy')).toBeLessThan(
      out.indexOf('The body.'),
    );
  });

  it('ends with a link back home, naming the app', () => {
    expect(out).toMatch(
      new RegExp(`<a [^>]*href="/"[^>]*>.*Back to ${BRAND_NAME}</a>`),
    );
    expect(out.indexOf('The body.')).toBeLessThan(out.indexOf('Back to'));
  });

  it('hides the arrow of the back link from assistive technology', () => {
    expect(out).toContain('<span aria-hidden="true">←</span>');
  });
});

describe('LegalSection', () => {
  it('is a section headed by its title, followed by its content', () => {
    const out = html(
      <LegalSection title="What we store">
        <p>Your name.</p>
      </LegalSection>,
    );
    expect(out).toContain('<section>');
    expect(out).toMatch(/<h2[^>]*>What we store<\/h2>/);
    expect(out.indexOf('What we store')).toBeLessThan(
      out.indexOf('Your name.'),
    );
  });
});

describe('LegalItem', () => {
  it('is a list item with a decorative marker hidden from assistive technology', () => {
    const out = html(<LegalItem>Your email.</LegalItem>);
    expect(out).toContain('<li');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('Your email.');
    expect(classOf(out, 'span')).toContain('bg-brand');
  });
});

describe('LegalLink', () => {
  it('opens another site in a new tab without a reference to this window', () => {
    const out = html(
      <LegalLink href="https://example.com/">Example</LegalLink>,
    );
    expect(out).toMatch(
      /<a href="https:\/\/example\.com\/" target="_blank" rel="noopener noreferrer"[^>]*>Example<\/a>/,
    );
  });

  it('links a page of this site in the same tab', () => {
    const out = html(<LegalLink href="/privacy">privacy policy</LegalLink>);
    expect(out).toMatch(/<a [^>]*href="\/privacy"[^>]*>privacy policy<\/a>/);
    expect(out).not.toContain('target="_blank"');
  });

  it('is underlined in the accent colour', () => {
    const out = html(<LegalLink href="/terms">terms</LegalLink>);
    expect(classOf(out, 'a')).toContain('text-accent');
    expect(classOf(out, 'a')).toContain('underline');
  });
});

describe('LegalCode', () => {
  it('sets a name in code type', () => {
    expect(html(<LegalCode>app_session</LegalCode>)).toBe(
      '<code class="font-mono text-base">app_session</code>',
    );
  });
});
