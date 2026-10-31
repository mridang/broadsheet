/**
 * @packageDocumentation
 *
 * Base64url + raw EC-point helpers. Web Push uses base64url (URL-safe,
 * no padding) for every key and salt; the platform `btoa`/`atob` give
 * standard base64 with `+`/`/` and `=` padding, so we translate.
 */

const PAD = '=';

/** Decode a base64 or base64url string to a Uint8Array. @public */
export function b64uDecode(input: string): Uint8Array {
  const std = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + PAD.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** Encode a byte buffer as base64url (no `=` padding). @public */
export function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) {
    s += String.fromCharCode(bytes[i]!);
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Concatenate any number of byte arrays in order. @public */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * A `Uint8Array` as a {@link BufferSource} for Web Crypto. The single assertion
 * bridges a Web-types gap: a typed array is a BufferSource at runtime, but the
 * lib models the underlying buffer's variance (it may be a `SharedArrayBuffer`),
 * so the assignment needs it. @public
 */
export function bs(input: Uint8Array): BufferSource {
  return input as BufferSource;
}
