/**
 * @packageDocumentation
 *
 * Our own addresses for pictures that live on other websites. Loading them
 * straight from there is slow (a new connection per site, full-size files),
 * leaks which pages you open to every site (referrers, cookies), breaks when a
 * site blocks hotlinking, and forces the Content Security Policy to name every
 * picture host. So pages ask our own `/api/img` for them (see `service.ts`):
 * it fetches the picture once, scales it down, and keeps a copy at the edge.
 *
 * This module is the part pages use, so it holds no server code: building
 * those addresses and deciding which pictures are ours to proxy. Which hosts
 * and widths an app uses is in `site.ts`.
 */

import { isPublicWebUrl } from '../http/safe-fetch';
import { parseUrl } from '../util/url';
import { ALLOWED_HOSTS, ALLOWED_WIDTHS } from './site';

/** The path every app serves its pictures from. */
export const IMAGE_PATH = '/api/img';

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
 * to show the picture (see `access.ts`).
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
 * `localhost` or an internal name; the rule every outbound fetch follows, see
 * `http/safe-fetch.ts`) on a host the app allows.
 */
export function isProxyableUrl(value: string): boolean {
  return isPublicWebUrl(value) && isAllowedHost(value);
}
