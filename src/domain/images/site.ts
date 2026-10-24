/**
 * @packageDocumentation
 *
 * What differs from one app to the next in the shared image proxy
 * (`lib/images/*`, `core/images/*`, `src/app/img/route.ts`): where pictures
 * may come from and the widths they are offered at. This is the app's own
 * {@link ImageSpec}, bound into an {@link ImageCatalog} the rest of the app
 * uses. Who may ask (the signature) is the image service's business.
 */

import { ImageCatalog, type ImageSpec } from '@/lib/images/address';

/**
 * The hosts the proxy fetches pictures from, or null for any public host. An
 * app that takes pictures from arbitrary websites must not leave the proxy
 * open to anyone, so it also checks a signature. Stories come from any site on
 * the web, so no host is named here: the signature, which only this server can
 * make, is the rule, and it covers Google's favicon service (`www.google.com`)
 * as much as an article's own picture.
 */
export const ALLOWED_HOSTS: readonly string[] | null = null;

/**
 * The widths (in pixels) a page may ask for; anything else snaps up to the
 * nearest: the favicon, and the picture of a standard, feature and lead
 * story (see `IMG_WIDTH` in `render/tiers.ts`).
 */
export const ALLOWED_WIDTHS: readonly number[] = [64, 480, 600, 800];

/** The width used when a request does not name a usable one. */
export const DEFAULT_WIDTH = 480;

/** This app's image proxy spec. */
export const IMAGE_SPEC: ImageSpec = {
  allowedHosts: ALLOWED_HOSTS,
  allowedWidths: ALLOWED_WIDTHS,
  defaultWidth: DEFAULT_WIDTH,
};

/** The catalog the app builds its picture addresses and proxy checks with. */
export const imageCatalog = new ImageCatalog(IMAGE_SPEC);
