import type { Metadata, Viewport } from 'next';
import type { ReactElement, ReactNode } from 'react';

import { ServiceWorker } from '@/components/site/service-worker';
import { ThemeScript } from '@/components/site/theme-script';

import { BODY_CLASS, HTML_ATTRIBUTES, HTML_CLASS } from './_fonts';
import { siteMetadata, siteViewport } from './_metadata';
import './globals.css';

/** What every page says about itself unless it says otherwise (see `_metadata.ts`). */
export const metadata: Metadata = siteMetadata();

/** How phones lay the page out, and the colour of the browser's own chrome. */
export const viewport: Viewport = siteViewport();

/**
 * The document every page sits in: the language, the typefaces, the page
 * colours, the script that applies a saved theme before the first paint (if
 * the app has one), and the service worker that makes the app installable. The
 * site's header and footer are added one level down, in the `(site)` layout,
 * so the not-found and error pages can use a plainer frame.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactElement {
  return (
    <html
      lang="en"
      className={HTML_CLASS}
      suppressHydrationWarning
      {...HTML_ATTRIBUTES}
    >
      <head>
        <ThemeScript />
      </head>
      <body className={BODY_CLASS}>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
