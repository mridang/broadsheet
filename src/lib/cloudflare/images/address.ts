/**
 * @packageDocumentation
 *
 * Our own addresses for pictures that live on other websites. Loading them
 * straight from there is slow (a new connection per site, full-size files),
 * leaks which pages you open to every site (referrers, cookies), breaks when a
 * site blocks hotlinking, and forces the Content Security Policy to name every
 * picture host. So pages ask our own `/img` for them (see the image service):
 * it fetches the picture once, scales it down, and keeps a copy at the edge.
 *
 * This module is the part pages use, so it holds no server code: building
 * those addresses and deciding which pictures are ours to proxy. Which hosts
 * and widths an app offers is injected as an {@link ImageSpec}, so the codec
 * stays app-agnostic; the handle is {@link ImageCatalog}.
 */

import { isPublicWebUrl } from '@/lib/safe-fetch';
import { parseUrl } from '@/utils/url';

/** The path every app serves its pictures from. */
export const IMAGE_PATH = '/img';

/** Which hosts and widths an app offers pictures at. */
export interface ImageSpec {
  /**
   * The hosts the proxy fetches pictures from, or null for any public host (an
   * app that proxies arbitrary sites then relies on the signature instead).
   */
  readonly allowedHosts: readonly string[] | null;
  /** The widths (in pixels) a page may ask for; anything else snaps up. */
  readonly allowedWidths: readonly number[];
  /** The width used when a request does not name a usable one. */
  readonly defaultWidth: number;
}

/**
 * Builds our picture addresses and decides which pictures are ours to proxy,
 * for one app's {@link ImageSpec}.
 */
export class ImageCatalog {
  readonly #spec: ImageSpec;
  readonly #largest: number;

  constructor(spec: ImageSpec) {
    this.#spec = spec;
    this.#largest = Math.max(...spec.allowedWidths);
  }

  /** The width used when a request does not name a usable one. */
  get defaultWidth(): number {
    return this.#spec.defaultWidth;
  }

  /** The nearest allowed width at or above `width` (the largest if none is). */
  snapWidth(width: number): number {
    return (
      [...this.#spec.allowedWidths]
        .sort((a, b) => a - b)
        .find((allowed) => allowed >= width) ?? this.#largest
    );
  }

  /**
   * Our address for the picture at `url`, scaled to the nearest allowed width.
   * `signature` is the proof, where an app asks for one, that this server chose
   * to show the picture.
   */
  src(url: string, width: number, signature?: string): string {
    const proof = signature ? `&sig=${encodeURIComponent(signature)}` : '';
    return `${IMAGE_PATH}?url=${encodeURIComponent(url)}&w=${this.snapWidth(width)}${proof}`;
  }

  /** A `srcset` of our addresses for a picture, one per width. */
  srcSet(
    url: string,
    widths: readonly number[] = this.#spec.allowedWidths,
    signature?: string,
  ): string {
    return widths
      .map((w) => `${this.src(url, w, signature)} ${this.snapWidth(w)}w`)
      .join(', ');
  }

  /**
   * Whether the host of an address is one this app serves pictures from. Every
   * public host qualifies when the app does not name any.
   */
  isAllowedHost(value: string): boolean {
    const host = parseUrl(value)?.hostname.toLowerCase();
    return (
      host !== undefined &&
      (this.#spec.allowedHosts === null ||
        this.#spec.allowedHosts.includes(host))
    );
  }

  /**
   * Whether an address is a picture we proxy: a public web address (http or
   * https on the usual ports, with a real hostname, never an IP address,
   * `localhost` or an internal name; the rule every outbound fetch follows) on
   * a host the app allows.
   */
  isProxyableUrl(value: string): boolean {
    return isPublicWebUrl(value) && this.isAllowedHost(value);
  }
}
