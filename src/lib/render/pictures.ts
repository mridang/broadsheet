/**
 * @packageDocumentation
 *
 * The addresses pages put on pictures from other websites (an article's photo,
 * a source's favicon): our own signed `/api/img` address, so the browser never
 * talks to the picture's site and the Content Security Policy can keep
 * `img-src` at this site.
 */

import { imageSrc, isProxyableUrl } from '../images/address';
import { signatureFor } from '../images/access';

/**
 * The address to show the picture at `src` at, about `width` pixels wide, or
 * null when it is not a picture we may proxy (empty, relative, or not a
 * public web address), so the page shows no picture instead of a broken one.
 */
export function pictureSrc(src: string, width: number): string | null {
  return isProxyableUrl(src) ? imageSrc(src, width, signatureFor(src)) : null;
}
