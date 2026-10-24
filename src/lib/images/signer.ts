/**
 * @packageDocumentation
 *
 * Which pictures anyone may ask the proxy for. Stories come from any site on
 * the web, so an open proxy would be a free image relay for everyone. Instead
 * every picture address the pages render carries a signature that only this
 * server can make (an HMAC of the address under the session secret), and the
 * proxy fetches nothing without a valid one. The signature does not cover the
 * width, so one signature serves a picture at every width the pages offer.
 *
 * This is a pure codec built on Web Crypto, so it runs unchanged on Cloudflare
 * Workers and anywhere else the platform provides `crypto.subtle` — no Node
 * built-ins. The handle is {@link ImageSigner}, built once with the secret.
 */

import {
  base64UrlToBytes,
  bufferSource,
  bytesToBase64Url,
} from '@/utils/base64';

/** Domain separation, so a signature made here is never valid for anything else. */
const CONTEXT = 'image:';

/**
 * Signs and verifies picture addresses. Build one with the session secret and
 * use it through {@link sign} and {@link verify}; both are async because Web
 * Crypto's HMAC is.
 */
export class ImageSigner {
  readonly #secret: string;
  #key: Promise<CryptoKey> | undefined;

  constructor(secret: string) {
    this.#secret = secret;
  }

  /** The HMAC-SHA-256 key for the secret, imported once and reused. */
  #hmacKey(): Promise<CryptoKey> {
    return (this.#key ??= crypto.subtle.importKey(
      'raw',
      bufferSource(new TextEncoder().encode(this.#secret)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    ));
  }

  /** The signature of `url`, URL-safe base64. */
  async sign(url: string): Promise<string> {
    const mac = await crypto.subtle.sign(
      'HMAC',
      await this.#hmacKey(),
      bufferSource(new TextEncoder().encode(`${CONTEXT}${url}`)),
    );
    return bytesToBase64Url(new Uint8Array(mac));
  }

  /**
   * Whether `signature` is the one this server made for `url`. Constant-time
   * via `crypto.subtle.verify`; a malformed signature is simply invalid.
   */
  async verify(url: string, signature: string | null): Promise<boolean> {
    if (signature === null) {
      return false;
    }
    try {
      return await crypto.subtle.verify(
        'HMAC',
        await this.#hmacKey(),
        bufferSource(base64UrlToBytes(signature)),
        bufferSource(new TextEncoder().encode(`${CONTEXT}${url}`)),
      );
    } catch {
      return false;
    }
  }
}
