import type { MetadataRoute } from 'next';

import {
  BACKGROUND_COLOR,
  BRAND_SHORT_NAME,
  MANIFEST_CATEGORIES,
  MANIFEST_DESCRIPTION,
  MANIFEST_EXTRAS,
  MANIFEST_NAME,
  THEME_COLOR,
} from './_brand';

/**
 * The web app manifest: what makes the app installable from Chrome and Safari
 * and what the installed app looks like. The theme colour is the browser's own
 * top bar and the installed app's title bar; the background is the page colour,
 * shown while the app starts. Whatever only one app offers (screenshots, a
 * share target, shortcuts) comes from `MANIFEST_EXTRAS` in `_brand.ts`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: MANIFEST_NAME,
    short_name: BRAND_SHORT_NAME,
    description: MANIFEST_DESCRIPTION,
    lang: 'en',
    dir: 'ltr',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    categories: [...MANIFEST_CATEGORIES],
    // Chromium on desktop: a second launch (a shortcut, a link) reuses the open
    // window instead of stacking another.
    launch_handler: { client_mode: 'navigate-existing' },
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      // Android 13+ themed icons colour this one themselves: only its shape
      // (the alpha channel) is used.
      {
        src: '/icons/icon-monochrome-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'monochrome',
      },
    ],
    ...MANIFEST_EXTRAS,
  };
}
