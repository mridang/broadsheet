/**
 * @packageDocumentation
 *
 * What every page says about itself, built the same way in every app: the
 * defaults the root layout sets, and one helper for a page's own metadata.
 * The values come from `_brand.ts`; nothing here is specific to one app.
 */

import type { Metadata, Viewport } from 'next';

import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRAND_SHORT_NAME,
  BRAND_TITLE,
  BRAND_URL,
  COLOR_SCHEME,
  INDEX_BY_DEFAULT,
  THEME_COLOR,
} from './_brand';

/** The tab title of a page called `title`: its own name, then the app's. */
function titleOf(title: string): string {
  return `${title} · ${BRAND_NAME}`;
}

/**
 * What every page says about itself unless it says otherwise: the title (with
 * the template that adds the app's name to a page's own), the description, the
 * social cards and the home-screen look on iOS. The social images, the icons
 * and the manifest link are added by Next from the files in `src/app`. Pages
 * override the parts they need to with {@link pageMetadata}.
 */
export function siteMetadata(): Metadata {
  return {
    metadataBase: new URL(BRAND_URL),
    title: { default: BRAND_TITLE, template: `%s · ${BRAND_NAME}` },
    description: BRAND_DESCRIPTION,
    robots: { index: INDEX_BY_DEFAULT, follow: INDEX_BY_DEFAULT },
    openGraph: {
      type: 'website',
      siteName: BRAND_NAME,
      locale: 'en_US',
      title: BRAND_TITLE,
      description: BRAND_DESCRIPTION,
      url: BRAND_URL,
    },
    applicationName: BRAND_NAME,
    // iOS: open from the home screen without Safari's chrome.
    appleWebApp: {
      capable: true,
      title: BRAND_SHORT_NAME,
      statusBarStyle: 'default',
    },
    formatDetection: { telephone: false },
    twitter: {
      card: 'summary_large_image',
      title: BRAND_TITLE,
      description: BRAND_DESCRIPTION,
    },
  };
}

/** How phones lay the page out, and the colour of the browser's own chrome. */
export function siteViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: THEME_COLOR,
    colorScheme: COLOR_SCHEME,
  };
}

/**
 * The picture shown when a page is shared: the site-wide card. A page that sets
 * its own `openGraph` or `twitter` replaces the root layout's, and with them
 * the images Next adds from `opengraph-image.png`, so each page names it.
 */
const SOCIAL_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: `${BRAND_NAME}: ${BRAND_TITLE}`,
} as const;

/** What a page says about itself. */
export type PageDetails = Readonly<{
  /** The page's own name; the template adds the app's. */
  title: string;
  /** What search results and social cards say; the app's own by default. */
  description?: string;
  /** The page's address on this site, which is also its canonical address. */
  path: string;
  /** Whether crawlers may index the page and follow its links. */
  index?: boolean;
}>;

/**
 * A page's metadata: its title (under the app's template), description,
 * canonical address, social cards and whether crawlers may index it. The
 * canonical address is resolved against `metadataBase`, and the social images
 * come from the site-wide card. A page that sets none of this inherits the
 * defaults of {@link siteMetadata}.
 */
export function pageMetadata({
  title,
  description = BRAND_DESCRIPTION,
  path,
  index = INDEX_BY_DEFAULT,
}: PageDetails): Metadata {
  const full = titleOf(title);
  return {
    title,
    description,
    robots: { index, follow: index },
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: BRAND_NAME,
      title: full,
      description,
      url: path,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: full,
      description,
      images: [SOCIAL_IMAGE],
    },
  };
}
