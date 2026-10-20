/**
 * @packageDocumentation
 *
 * What the site calls itself and where it lives, in one place for the page
 * metadata, the structured data and outbound fetches (see `http/safe-fetch.ts`).
 * The first four constants are in every app; the rest are this app's own.
 */

/** The name of the site, as it appears in titles and structured data. */
export const SITE_NAME = 'broadsheet';
/** The site's public address, with no trailing slash. */
export const SITE_URL = 'https://broadsheet.apps.mrida.ng';

/** The site's default page title. */
export const SITE_TITLE = 'The Hacker Times';
/** The site's default description, for page metadata and structured data. */
export const SITE_DESCRIPTION =
  'A personalised daily newspaper, generated fresh from the feeds you follow.';
