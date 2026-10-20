/**
 * @packageDocumentation
 *
 * Everything about this app's identity that the shared app shell reads: its
 * name and descriptions, its colours, what search engines may crawl, what the
 * installed app offers, and the wording of the not-found and error pages. The
 * shell files (`layout.tsx`, `_metadata.ts`, `manifest.ts`, `robots.ts`,
 * `sitemap.ts`, `error.tsx`, `global-error.tsx`, `not-found.tsx`) are the same
 * in every app, and this file is where they differ. It keeps the same export
 * names in every app, and holds values only: no components, no side effects.
 */

import type { MetadataRoute } from 'next';

import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from '@/lib/site';

/** The name of the app, as the wordmark, the tab title suffix and the home-screen label. */
export const BRAND_NAME = SITE_TITLE;

/** The name where space is short: under the home-screen icon, and as the installed app's short name. */
export const BRAND_SHORT_NAME = 'Hacker Times';

/** The small descriptor under the wordmark and on the social card. */
export const BRAND_TAGLINE = 'A personalised daily newspaper';

/** The title of the home page, and of any page that does not set its own. */
export const BRAND_TITLE = SITE_TITLE;

/** What search results and social cards say about the app. */
export const BRAND_DESCRIPTION = SITE_DESCRIPTION;

/** The public address of the app, with no trailing slash. */
export const BRAND_URL = SITE_URL;

/** Where to report a security problem: published in `security.txt` and the security policy. */
export const SECURITY_CONTACT = 'mailto:mridang.agarwalla@gmail.com';

/** The disclosure policy that `security.txt` points researchers to (`public/security-policy.txt`). */
export const SECURITY_POLICY_URL = `${SITE_URL}/security-policy.txt`;

/**
 * The crimson of the masthead in the default theme: the browser's own bar and
 * the installed app's title bar. (The theme switcher changes the bar's colour
 * for the Economist theme while the page is open; see `theme-script.tsx`.)
 */
export const THEME_COLOR = '#990F3D';

/** The newsprint colour of the page, shown while the installed app starts. */
export const BACKGROUND_COLOR = '#FFF1E5';

/**
 * Which colour schemes the app is drawn in. Both newspaper themes are light,
 * and saying so stops Android's "auto dark" from inverting the pages.
 */
export const COLOR_SCHEME = 'only light';

/**
 * Whether pages may be indexed unless they say otherwise. Only the front page
 * (the public Hacker News edition) is; the sign-in and feed pages are not.
 * robots.txt and an `X-Robots-Tag` header (see `lib/http/headers.ts`) say the
 * same thing.
 */
export const INDEX_BY_DEFAULT = false;

/** The only page a crawler may read; everything else is private. */
export const CRAWLABLE_PATHS: readonly string[] = ['/$'];

/** The paths crawlers must stay out of: the feed manager, the sign-in flow and the API. */
export const PRIVATE_PATHS: readonly string[] = ['/feeds', '/login', '/api/'];

/** The pages worth listing in the sitemap: the front page, which changes daily and so has no `lastmod`. */
export const SITEMAP_PAGES: readonly Readonly<{
  path: string;
  lastModified?: string;
}>[] = [{ path: '/' }];

/** The name of the installed app, where there is room for more than the short name. */
export const MANIFEST_NAME = BRAND_NAME;

/** What the install dialog says the app is. */
export const MANIFEST_DESCRIPTION = BRAND_DESCRIPTION;

/** The store categories of the installed app. */
export const MANIFEST_CATEGORIES: readonly string[] = ['news'];

/** What only this app's installed form offers. Nothing: no screenshots, share target or shortcuts. */
export const MANIFEST_EXTRAS: Pick<
  MetadataRoute.Manifest,
  'screenshots' | 'share_target' | 'shortcuts'
> = {};

/** What the not-found page says under its heading. */
export const NOT_FOUND_NOTE =
  'The link may be out of date, or the page may have been moved.';

/** A second way back from the not-found page, beside "Back to the home page". */
export const NOT_FOUND_LINK: Readonly<{ href: string; label: string }> | null =
  null;

/** The reassurance on the error pages, after "Something went wrong". */
export const ERROR_REASSURANCE =
  'Try again in a moment, and your feeds and past editions will be here either way.';
