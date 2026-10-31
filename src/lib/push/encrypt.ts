/**
 * @packageDocumentation
 *
 * Web Push payload encryption (RFC 8291, `aes128gcm` content-encoding).
 * The recipient subscription gives us a P-256 public key (`p256dh`) and
 * a 16-byte auth secret. We:
 *
 *   1. Generate a fresh server P-256 keypair for this single message.
 *   2. ECDH(server-private, sub-public) → 32-byte shared secret.
 *   3. HKDF-Extract(sub-auth, ECDH) → PRK_key.
 *   4. HKDF-Expand a 16-byte content-encryption key + 12-byte nonce.
 *   5. AES-128-GCM(plaintext + 0x02 padding marker).
 *   6. Prepend the RFC 8188 header (salt, rs, idlen, keyid=server pubkey).
 *
 * Output is a single binary blob ready to POST as the body with
 * `Content-Encoding: aes128gcm`.
 */

import { b64uDecode, bs, concatBytes } from './encode';

/** Result of {@link encryptPayload}: the bytes to POST and the salt+key for headers. @public */
export interface EncryptedPayload {
  /** Full RFC 8188 body — header || ciphertext. */
  readonly body: Uint8Array;
  /** Server's ephemeral public key (uncompressed point). */
  readonly serverPublicKey: Uint8Array;
  /** 16-byte random salt embedded in the body header. */
  readonly salt: Uint8Array;
}

/**
 * Encrypt `plaintext` for a single Web Push recipient. The shape matches
 * what browsers expect when the body is sent with
 * `Content-Encoding: aes128gcm`. @public
 */
export async function encryptPayload(opts: {
  readonly plaintext: Uint8Array;
  readonly subscriberPublicKeyB64u: string;
  readonly subscriberAuthB64u: string;
  /** Override the random salt for deterministic tests. */
  readonly saltOverride?: Uint8Array;
  /** Override the server ephemeral keypair for deterministic tests. */
  readonly serverKeyPairOverride?: CryptoKeyPair;
}): Promise<EncryptedPayload> {
  const subPubBytes = b64uDecode(opts.subscriberPublicKeyB64u);
  const subAuth = b64uDecode(opts.subscriberAuthB64u);

  const serverKeyPair =
    opts.serverKeyPairOverride ??
    (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    ));

  const serverPubJwk = await crypto.subtle.exportKey(
    'jwk',
    serverKeyPair.publicKey,
  );
  const serverPub = jwkToUncompressedPoint(serverPubJwk);

  const subPubKey = await crypto.subtle.importKey(
    'raw',
    bs(subPubBytes),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: subPubKey },
      serverKeyPair.privateKey,
      256,
    ),
  );

  // First HKDF (RFC 8291 §3.3): combine subscriber's auth + ECDH.
  const authInfo = concatBytes(
    new TextEncoder().encode('WebPush: info'),
    new Uint8Array([0x00]),
    subPubBytes,
    serverPub,
  );
  const prkKey = await hkdf(subAuth, sharedSecret, authInfo, 32);

  const salt = opts.saltOverride ?? crypto.getRandomValues(new Uint8Array(16));

  // Content-encryption key (16 bytes) and nonce (12 bytes), per RFC 8188.
  const cek = await hkdf(
    salt,
    prkKey,
    concatBytes(
      new TextEncoder().encode('Content-Encoding: aes128gcm'),
      new Uint8Array([0x00]),
    ),
    16,
  );
  const nonce = await hkdf(
    salt,
    prkKey,
    concatBytes(
      new TextEncoder().encode('Content-Encoding: nonce'),
      new Uint8Array([0x00]),
    ),
    12,
  );

  // The 0x02 byte is the single-record padding delimiter; with one record
  // and no extra padding this is the only padding byte needed.
  const padded = concatBytes(opts.plaintext, new Uint8Array([0x02]));
  const cekKey = await crypto.subtle.importKey(
    'raw',
    bs(cek),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: bs(nonce) },
      cekKey,
      bs(padded),
    ),
  );

  // RFC 8188 header: salt(16) || rs(4 big-endian) || idlen(1) || keyid(idlen).
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concatBytes(
    salt,
    rs,
    new Uint8Array([serverPub.length]),
    serverPub,
  );

  return {
    body: concatBytes(header, ciphertext),
    serverPublicKey: serverPub,
    salt,
  };
}

/** Translate a P-256 JWK public key into the 65-byte uncompressed point form. */
function jwkToUncompressedPoint(jwk: JsonWebKey): Uint8Array {
  if (jwk.x === undefined || jwk.y === undefined) {
    throw new Error('JWK is missing x/y coordinates');
  }
  return concatBytes(
    new Uint8Array([0x04]),
    b64uDecode(jwk.x),
    b64uDecode(jwk.y),
  );
}

/**
 * HKDF (RFC 5869) helper: single Expand step on top of an HMAC-SHA-256
 * Extract. Web Crypto's native `HKDF` requires a CryptoKey and doesn't
 * expose the intermediate PRK we need to thread between RFC 8291's two
 * HKDF chains, so we implement it directly on top of `crypto.subtle.sign`.
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const prk = await hmacSha256(salt, ikm);
  return hkdfExpand(prk, info, length);
}

async function hmacSha256(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bs(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bs(data)));
}

async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  // The required output never exceeds 32 bytes here, so a single block (T(1)) is enough.
  const block = await hmacSha256(
    prk,
    concatBytes(info, new Uint8Array([0x01])),
  );
  return block.slice(0, length);
}
