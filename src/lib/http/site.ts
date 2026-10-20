/**
 * @packageDocumentation
 *
 * What differs from one app to the next in the shared HTTP security code
 * (`headers.ts`, `csp.ts`): the pages search engines may index, the files other
 * sites may load, and the few outside places a page may show a picture from.
 * Everything else in those files is the same in every app.
 */

/** The pages search engines may index. Everything else is private. */
export const PUBLIC_PAGES: ReadonlySet<string> = new Set(['/']);

/**
 * The files other sites embed or fetch on purpose (the icons, the manifest and
 * the plain-text files at the root). They are open to all and not marked
 * noindex.
 */
export const OPEN_FILES =
  /^\/(favicon\.ico|icon\.svg|manifest\.webmanifest|robots\.txt|sitemap\.xml|\.well-known\/.*)$/;

/**
 * The outside places pages may load pictures from, besides this site. A story
 * source's small icon comes from Google's favicon service, which answers with a
 * redirect to its own image host; a browser checks the redirect against the
 * policy too, so both are listed. Article pictures are not here: they come
 * through this site's own `/img` address.
 */
export const EXTRA_IMG_SOURCES: readonly string[] = [
  'https://www.google.com',
  'https://*.gstatic.com',
];
