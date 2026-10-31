/**
 * @packageDocumentation
 *
 * VAPID (RFC 8292) JWT signer. The push service authenticates the sender
 * with an ES256-signed JWT plus the matching public key, so spam can be
 * blocked at the push endpoint. We sign with Web Crypto (no Node
 * dependency) and ship a base64url-uncompressed-point public key.
 */

import { b64uDecode, b64uEncode, bs } from './encode';

interface VapidClaims {
  /** Audience: the push endpoint's origin (https://fcm.googleapis.com etc.). */
  readonly aud: string;
  /** Subject: contact mailto: or https://. The push service uses it for abuse reports. */
  readonly sub: string;
  /** Expiry (unix seconds). Must be at most 24h ahead. */
  readonly exp: number;
}

/**
 * Build the `Authorization: vapid t=<jwt>, k=<publicKey>` header for one
 * push request. The token expires 12h after `nowSeconds` (well below the
 * spec's 24h ceiling).
 *
 * @public
 */
export async function signVapidAuthHeader(opts: {
  readonly audience: string;
  readonly subject: string;
  readonly publicKeyB64u: string;
  readonly privateKeyB64u: string;
  readonly nowSeconds: number;
}): Promise<string> {
  const claims: VapidClaims = {
    aud: opts.audience,
    sub: opts.subject,
    exp: opts.nowSeconds + 12 * 3600,
  };
  const header = b64uEncode(
    new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
  );
  const payload = b64uEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;

  const key = await importPrivateKey(opts.privateKeyB64u, opts.publicKeyB64u);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    bs(new TextEncoder().encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64uEncode(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${opts.publicKeyB64u}`;
}

/**
 * Import a base64url P-256 `d` value as a CryptoKey usable for ECDSA
 * signing. Web Crypto only accepts JWK or PKCS#8 — we rebuild the JWK
 * from the supplied public key's uncompressed point and the private
 * scalar.
 */
async function importPrivateKey(
  privateKeyB64u: string,
  publicKeyB64u: string,
): Promise<CryptoKey> {
  const publicKeyBytes = b64uDecode(publicKeyB64u);
  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) {
    throw new Error(
      'VAPID public key must be a 65-byte uncompressed P-256 point starting with 0x04',
    );
  }
  const x = b64uEncode(publicKeyBytes.slice(1, 33));
  const y = b64uEncode(publicKeyBytes.slice(33, 65));
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x,
    y,
    d: privateKeyB64u,
    ext: true,
  };
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}
