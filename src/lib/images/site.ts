/**
 * @packageDocumentation
 *
 * What differs from one app to the next in the shared image proxy
 * (`address.ts`, `proxy.ts`, `service.ts`, `src/app/api/img/route.ts`): where
 * pictures may come from and the widths they are offered at. The code that
 * decides who may ask lives in `access.ts`. Everything else is the same in
 * every app.
 */

/**
 * The hosts the proxy fetches pictures from, or null for any public host. An
 * app that takes pictures from arbitrary websites must not leave the proxy
 * open to anyone, so it also checks a signature in `access.ts`. Stories come
 * from any site on the web, so no host is named here: the signature, which
 * only this server can make, is the rule, and it covers Google's favicon
 * service (`www.google.com`) as much as an article's own picture.
 */
export const ALLOWED_HOSTS: readonly string[] | null = null;

/**
 * The widths (in pixels) a page may ask for; anything else snaps up to the
 * nearest: the favicon, and the picture of a standard, feature and lead
 * story (see `IMG_WIDTH` in `lib/render/tiers.ts`).
 */
export const ALLOWED_WIDTHS: readonly number[] = [64, 480, 600, 800];

/** The width used when a request does not name a usable one. */
export const DEFAULT_WIDTH = 480;
