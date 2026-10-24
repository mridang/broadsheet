import { describe, expect, it, jest } from '@jest/globals';

import { BRAND_URL, COLOR_SCHEME, INDEX_BY_DEFAULT } from '@/app/_brand';
import manifest from '@/app/manifest';
import { html } from '../components/render';

// The stylesheet, the fonts (which only work inside the Next compiler) and the
// two scripts are not what is under test: the frame around the page is.
jest.unstable_mockModule('@/app/globals.css', () => ({}));
jest.unstable_mockModule('@/app/_fonts', () => ({
  HTML_CLASS: 'fonts-on-html',
  BODY_CLASS: 'classes-on-body',
  HTML_ATTRIBUTES: { 'data-test': 'yes' },
}));
jest.unstable_mockModule('@/components/site/service-worker', () => ({
  ServiceWorker: () => <i id="service-worker" />,
}));
jest.unstable_mockModule('@/components/site/theme-script', () => ({
  ThemeScript: () => <i id="theme-script" />,
}));

const {
  default: RootLayout,
  metadata,
  viewport,
} = await import('@/app/layout');

describe('RootLayout', () => {
  it('follows the app’s choice of whether pages may be indexed', () => {
    expect(metadata.robots).toEqual({
      index: INDEX_BY_DEFAULT,
      follow: INDEX_BY_DEFAULT,
    });
  });

  it('resolves relative addresses against the site', () => {
    expect(new URL(String(metadata.metadataBase)).origin).toBe(BRAND_URL);
  });

  it('says the page language for Open Graph', () => {
    expect(metadata.openGraph).toMatchObject({ locale: 'en_US' });
  });

  it('puts the app’s name after a page’s own title', () => {
    expect(metadata.title).toMatchObject({
      template: expect.stringMatching(/^%s · .+/),
    });
  });

  it('asks for the colour scheme the app is drawn in', () => {
    expect(viewport.colorScheme).toBe(COLOR_SCHEME);
  });

  it('colours the browser bar like the installed app', () => {
    expect(viewport.themeColor).toBe(manifest().theme_color);
  });

  it('does not zoom-lock the page', () => {
    expect(viewport).toMatchObject({ width: 'device-width', initialScale: 1 });
    expect(viewport).not.toHaveProperty('maximumScale');
    expect(viewport).not.toHaveProperty('userScalable');
  });

  it('is the document: its language, the app’s classes and attributes, the theme script, the page and the worker', () => {
    const out = html(
      <RootLayout>
        <main>hello</main>
      </RootLayout>,
    );
    expect(out).toMatch(
      /<html lang="en" class="fonts-on-html" data-test="yes"/,
    );
    expect(out).toContain('<body class="classes-on-body">');
    expect(out.indexOf('theme-script')).toBeLessThan(out.indexOf('<main>'));
    expect(out).toContain('<main>hello</main>');
    expect(out.indexOf('<main>')).toBeLessThan(out.indexOf('service-worker'));
  });

  it('lets an overflowing child show, rather than hiding it on the body', () => {
    expect(html(<RootLayout>{null}</RootLayout>)).not.toContain(
      'overflow-x-hidden',
    );
  });
});
