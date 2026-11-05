/**
 * @packageDocumentation
 *
 * What the site calls itself and where it lives, in one place for the page
 * metadata, the structured data and outbound fetches (see `lib/safe-fetch.ts`).
 * The first four constants and the three for the structured data are in every
 * app, with this app's values; the rest are this app's own.
 */

/** The name of the site, as it appears in titles and structured data. */
export const SITE_NAME = 'Broadsheet';
/** The site's public address, with no trailing slash. */
export const SITE_URL = 'https://broadsheet.apps.mrida.ng';

/** The site's default page title. */
export const SITE_TITLE = 'Broadsheet';
/** The site's default description, for page metadata and structured data. */
export const SITE_DESCRIPTION =
  'A personalised daily newspaper, generated fresh from the feeds you follow.';
/** The schema.org application category of the app, for the structured data. */
export const SITE_APPLICATION_CATEGORY = 'ReferenceApplication';
/** What a visitor needs to use the app, for the structured data. */
export const SITE_REQUIREMENTS =
  'Requires a modern web browser; signing in with Google is only needed to follow your own feeds';
/** What the app does, one short sentence each, for the structured data. */
export const SITE_FEATURES: readonly string[] = [
  'A personalised daily newspaper built from the feeds you follow',
  'Back issues and custom editions',
  'Save, share and email stories',
  'An assistant that answers questions about your reading',
];

/** Where the source code lives. */
export const SOURCE_URL = 'https://github.com/mridang/broadsheet';
/** Where people write to about their data or these terms. */
export const CONTACT_EMAIL = 'mridang.agarwalla@gmail.com';
/** The day the privacy policy last changed, for the page and the sitemap. */
export const PRIVACY_LAST_UPDATED = '2026-11-01';
/** The day the terms of service last changed, for the page and the sitemap. */
export const TERMS_LAST_UPDATED = '2026-11-01';
