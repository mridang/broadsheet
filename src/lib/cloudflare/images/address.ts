/**
 * @packageDocumentation
 *
 * Our own addresses for pictures that live on other websites. Loading them
 * straight from there is slow (a new connection per site, full-size files),
 * leaks which pages you open to every site (referrers, cookies), breaks when a
 * site blocks hotlinking, and forces the Content Security Policy to name every
 * picture host. So pages ask our own `/img` for them (see `./server`): it
 * fetches the picture once, scales it down, and keeps a copy at the edge.
 *
 * This is the client-safe render surface: building those addresses and
 * deciding which pictures are ours to proxy. It holds the app's allowed hosts
 * and widths as plain constants and reads them directly, so a page needs only
 * these functions to render an image and pulls in no server code.
 */

import { isPublicWebUrl } from '@/lib/safe-fetch';
import { parseUrl } from '@/utils/url';

/** The path every app serves its pictures from. */
export const IMAGE_PATH = '/img';

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
 * nearest: the favicon, and the picture of a standard, feature and lead story
 * (see `IMG_WIDTH` in `domain/render/tiers.ts`).
 */
export const ALLOWED_WIDTHS: readonly number[] = [64, 480, 600, 800];

/** The width used when a request does not name a usable one. */
export const DEFAULT_WIDTH = 480;

/** The widest picture an app offers, in pixels. */
const LARGEST_WIDTH = Math.max(...ALLOWED_WIDTHS);

/** The nearest allowed width at or above `width` (the largest if none is). */
export function snapWidth(width: number): number {
  return (
    [...ALLOWED_WIDTHS]
      .sort((a, b) => a - b)
      .find((allowed) => allowed >= width) ?? LARGEST_WIDTH
  );
}

/**
 * Our address for the picture at `url`, scaled to the nearest allowed width.
 * `signature` is the proof, where an app asks for one, that this server chose
 * to show the picture.
 */
export function imageSrc(
  url: string,
  width: number,
  signature?: string,
): string {
  const proof = signature ? `&sig=${encodeURIComponent(signature)}` : '';
  return `${IMAGE_PATH}?url=${encodeURIComponent(url)}&w=${snapWidth(width)}${proof}`;
}

/** A `srcset` of our addresses for a picture, one per width. */
export function imageSrcSet(
  url: string,
  widths: readonly number[] = ALLOWED_WIDTHS,
  signature?: string,
): string {
  return widths
    .map((w) => `${imageSrc(url, w, signature)} ${snapWidth(w)}w`)
    .join(', ');
}

/**
 * Whether the host of an address is one this app serves pictures from. Every
 * public host qualifies when the app does not name any.
 */
export function isAllowedHost(value: string): boolean {
  const host = parseUrl(value)?.hostname.toLowerCase();
  return (
    host !== undefined &&
    (ALLOWED_HOSTS === null || ALLOWED_HOSTS.includes(host))
  );
}

/**
 * Whether an address is a picture we proxy: a public web address (http or
 * https on the usual ports, with a real hostname, never an IP address,
 * `localhost` or an internal name; the rule every outbound fetch follows) on a
 * host the app allows.
 */
export function isProxyableUrl(value: string): boolean {
  return isPublicWebUrl(value) && isAllowedHost(value);
}
