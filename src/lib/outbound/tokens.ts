/**
 * @packageDocumentation
 *
 * Random secrets and their fingerprints, with Web Crypto: the tokens a feed
 * reader presents and the secrets webhooks are signed with. A token is shown
 * once and only its SHA-256 is kept.
 */

/** Bytes as unpadded base64url. */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Unpadded (or padded) base64url as bytes; undefined when it is not base64url. */
export function fromBase64Url(
  text: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return undefined;
  const base64 = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** A new random secret of `bytes` bytes, as base64url. */
export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Lowercase hex of bytes. */
export function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The SHA-256 of a string, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
}
