import { describe, expect, it } from '@jest/globals';

import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRAND_SHORT_NAME,
  BRAND_URL,
  INDEX_BY_DEFAULT,
} from '../../src/app/_brand';
import { pageMetadata, siteMetadata } from '../../src/app/_metadata';

describe('siteMetadata', () => {
  const site = siteMetadata();

  it('titles a page by the template, and the home page by the default', () => {
    expect(site.title).toEqual({
      default: expect.any(String),
      template: `%s · ${BRAND_NAME}`,
    });
  });

  it('describes the app, in the card as well', () => {
    expect(site.description).toBe(BRAND_DESCRIPTION);
    expect(site.openGraph).toMatchObject({
      siteName: BRAND_NAME,
      url: BRAND_URL,
    });
    expect(site.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('lets the app be added to the iOS home screen', () => {
    expect(site.appleWebApp).toMatchObject({
      capable: true,
      title: BRAND_SHORT_NAME,
    });
  });
});

describe('pageMetadata', () => {
  const page = pageMetadata({ title: 'Privacy', path: '/privacy' });

  it('gives the page its own title, to which the template adds the app’s', () => {
    expect(page.title).toBe('Privacy');
  });

  it('names the app in the social cards, where the template does not reach', () => {
    expect(page.openGraph).toMatchObject({ title: `Privacy · ${BRAND_NAME}` });
    expect(page.twitter).toMatchObject({ title: `Privacy · ${BRAND_NAME}` });
  });

  it('is canonical at its own address', () => {
    expect(page.alternates).toEqual({ canonical: '/privacy' });
    expect(page.openGraph).toMatchObject({ url: '/privacy' });
  });

  it('says the app’s description unless the page has its own', () => {
    expect(page.description).toBe(BRAND_DESCRIPTION);
    expect(
      pageMetadata({ title: 'A', path: '/a', description: 'Mine' }).description,
    ).toBe('Mine');
  });

  it('carries the site-wide card, which a page’s own openGraph would otherwise drop', () => {
    expect(page.openGraph).toMatchObject({
      images: [{ url: '/opengraph-image.png', width: 1200, height: 630 }],
    });
    expect(page.twitter).toMatchObject({
      images: [{ url: '/opengraph-image.png' }],
    });
  });

  it('follows the app’s default on indexing unless the page says otherwise', () => {
    expect(page.robots).toEqual({
      index: INDEX_BY_DEFAULT,
      follow: INDEX_BY_DEFAULT,
    });
    expect(
      pageMetadata({ title: 'A', path: '/a', index: true }).robots,
    ).toEqual({ index: true, follow: true });
    expect(
      pageMetadata({ title: 'A', path: '/a', index: false }).robots,
    ).toEqual({ index: false, follow: false });
  });
});
