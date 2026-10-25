/**
 * @packageDocumentation
 *
 * The addresses pages put on pictures from other websites (an article's photo,
 * a source's favicon): our own signed `/img` address, so the browser never
 * talks to the picture's site and the Content Security Policy can keep
 * `img-src` at this site.
 */

import { imageSrc, isProxyableUrl } from '@/lib/cloudflare/images';
import type { ImageSigner } from '@/lib/cloudflare/images/server';

/**
 * The address to show the picture at `src` at, about `width` pixels wide, or
 * null when it is not a picture we may proxy (empty, relative, or not a
 * public web address), so the page shows no picture instead of a broken one.
 * `signer` stamps the address so the proxy will serve it; without one (no
 * secret, as in tests or a build) the address carries no signature.
 */
export async function pictureSrc(
  src: string,
  width: number,
  signer?: ImageSigner,
): Promise<string | null> {
  if (!isProxyableUrl(src)) {
    return null;
  }
  const signature = signer ? await signer.sign(src) : undefined;
  return imageSrc(src, width, signature);
}
