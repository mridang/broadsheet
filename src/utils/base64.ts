/**
 * @packageDocumentation
 *
 * Base64 and URL-safe base64 for raw bytes, plus the one Web Crypto typing
 * helper that goes with them. The signed session token, the encrypted refresh
 * token, PKCE challenges, client secrets and pagination cursors all need
 * these, and they run unchanged on Cloudflare Workers and under Jest because
 * `btoa`/`atob` are globals in both.
 */

/** Encode raw bytes as standard (padded) base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  // btoa wants a "binary string": one character per byte.
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

/** Decode standard base64 into raw bytes. Throws on malformed input. */
export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** Encode raw bytes as URL-safe base64 (`-` and `_`, no padding). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode URL-safe base64, with or without padding, into raw bytes. Throws on malformed input. */
export function base64UrlToBytes(text: string): Uint8Array {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/');
  // Put back the padding that the URL-safe form leaves off.
  return base64ToBytes(standard + '==='.slice((standard.length + 3) % 4));
}

/**
 * Re-wrap bytes as an ArrayBuffer-backed view. Web Crypto's `BufferSource`
 * requires an `ArrayBuffer` (not the wider `ArrayBufferLike`, which includes
 * `SharedArrayBuffer`), and `TextEncoder`/views can be typed as the latter, so
 * copying through the array-like constructor guarantees the exact type.
 */
export function bufferSource(bytes: Uint8Array): BufferSource {
  return new Uint8Array(bytes);
}
