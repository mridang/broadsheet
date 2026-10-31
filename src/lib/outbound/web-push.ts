/**
 * @packageDocumentation
 *
 * Web Push in pure Web Crypto, with no native module: the payload is encrypted
 * to the browser's keys with `aes128gcm` (RFC 8291 over RFC 8188) and the
 * request is signed for the push service with a VAPID JWT (RFC 8292).
 *
 * The VAPID keys are a P-256 pair: the public key as the 65-byte uncompressed
 * point and the private key as its 32-byte scalar, both base64url (what
 * `npx web-push generate-vapid-keys` prints).
 */

import { base64Url, fromBase64Url } from './tokens';

/** What a browser handed over when it subscribed. */
export interface PushTarget {
  readonly endpoint: string;
  /** The browser's P-256 public key, base64url. */
  readonly p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  readonly auth: string;
}

/** The application server's VAPID identity. */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  /** A `mailto:` or `https:` address the push service can contact. */
  readonly subject: string;
}

/** The record size the payload is written in; one record carries it all. */
const RECORD_SIZE = 4096;

/** How long a VAPID signature is good for, in seconds (the most allowed is a day). */
const JWT_LIFETIME = 12 * 60 * 60;

const encoder = new TextEncoder();

/** Several byte arrays as one. */
function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** HKDF-SHA256 (extract and expand) of `ikm` to `length` bytes. */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveBits',
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      key,
      length * 8,
    ),
  );
}

/** Bytes from base64url, or a thrown error naming what was wrong. */
function decode(text: string, what: string): Uint8Array<ArrayBuffer> {
  const bytes = fromBase64Url(text);
  if (!bytes) throw new Error(`${what} is not base64url`);
  return bytes;
}

/**
 * Encrypt `payload` to a browser's keys as one `aes128gcm` record:
 * salt, record size, the server's one-off public key, then the ciphertext.
 * `ephemeral` and `salt` are only passed by tests.
 */
export async function encryptPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  payload: string,
  ephemeral?: CryptoKeyPair,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = decode(target.p256dh, 'p256dh');
  const authSecret = decode(target.auth, 'auth');
  const pair =
    ephemeral ??
    ((await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
  );
  const browserKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: browserKey },
      pair.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(
    authSecret,
    shared,
    concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(
    salt,
    ikm,
    encoder.encode('Content-Encoding: aes128gcm\0'),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    encoder.encode('Content-Encoding: nonce\0'),
    12,
  );
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, [
    'encrypt',
  ]);
  // 0x02 marks the last (and only) record.
  const plaintext = concat(encoder.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext),
  );
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** The VAPID private key as a signing key; its public point gives `x` and `y`. */
async function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  const point = decode(keys.publicKey, 'VAPID public key');
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error('VAPID public key is not an uncompressed P-256 point');
  }
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: base64Url(point.subarray(1, 33)),
      y: base64Url(point.subarray(33)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * The `Authorization` header for a push to `endpoint`: a VAPID JWT for the
 * push service's origin, signed ES256, and the public key it verifies with.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const part = (value: object) =>
    base64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: now + JWT_LIFETIME,
    sub: keys.subject,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await signingKey(keys),
    encoder.encode(unsigned),
  );
  return `vapid t=${unsigned}.${base64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/** The request that delivers `payload` to one browser. */
export interface PushRequest {
  readonly headers: Record<string, string>;
  readonly body: Uint8Array<ArrayBuffer>;
}

/** Build the encrypted, signed request for one push. */
export async function pushRequest(
  target: PushTarget,
  payload: string,
  keys: VapidKeys,
  ttlSeconds = 24 * 60 * 60,
): Promise<PushRequest> {
  return {
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'normal',
    },
    body: await encryptPayload(target, payload),
  };
}
