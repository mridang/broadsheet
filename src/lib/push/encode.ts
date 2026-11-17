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
  const std = input.replaceAll('-', '+').replaceAll('_', '/');
  const padded = std + PAD.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (char) => char.codePointAt(0) ?? 0);
}

/** Encode a byte buffer as base64url (no `=` padding). @public */
export function b64uEncode(bytes: Uint8Array): string {
  const s = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
  const [unpadded = ''] = btoa(s)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .split('=');
  return unpadded;
}

/** Concatenate any number of byte arrays in order. @public */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

/**
 * A `Uint8Array` as a {@link BufferSource} for Web Crypto. The single assertion
 * bridges a Web-types gap: a typed array is a BufferSource at runtime, but the
 * lib models the underlying buffer's variance (it may be a `SharedArrayBuffer`),
 * so the assignment needs it. @public.
 */
export function bs(input: Uint8Array): BufferSource {
  return input as BufferSource;
}
