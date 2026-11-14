/**
 * @packageDocumentation
 *
 * Opaque secrets (codes, access tokens, refresh tokens). Each is 256 random
 * bits with a readable prefix; only a SHA-256 hash is ever stored, so a leaked
 * database can't be replayed against the API. Because the secrets are random
 * and long, a plain fast hash is enough (no salt or slow KDF needed).
 */

import { bytesToBase64Url } from '@/utils/base64';

/** The readable prefix on an authorization code. */
export const CODE_PREFIX = 'cdn_code';
/** The readable prefix on an access token. */
export const ACCESS_PREFIX = 'cdn_at';
/** The readable prefix on a refresh token. */
export const REFRESH_PREFIX = 'cdn_rt';

/** The kinds of secret there are, by prefix. */
export type SecretPrefix =
  typeof CODE_PREFIX | typeof ACCESS_PREFIX | typeof REFRESH_PREFIX;

/** A new random secret such as `cdn_at_Qk3…`. */
export function newSecret(prefix: SecretPrefix): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}_${bytesToBase64Url(bytes)}`;
}

/** The hex SHA-256 of a secret — what the database stores and looks up. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
