import { describe, expect, it } from '@jest/globals';

import { base64Url, fromBase64Url } from '@/lib/outbound/tokens';
import {
  encryptPayload,
  pushRequest,
  vapidAuthorization,
  type VapidKeys,
} from '@/lib/outbound/web-push';

const encoder = new TextEncoder();

/** A P-256 key pair for `usage`, and its raw public point. */
async function pair(name: 'ECDH' | 'ECDSA') {
  const keys = (await crypto.subtle.generateKey(
    { name, namedCurve: 'P-256' },
    true,
    name === 'ECDH' ? ['deriveBits'] : ['sign', 'verify'],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer,
  );
  return { keys, raw };
}

/** HKDF-SHA256 for the test's own decryption. */
async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
) {
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

/** Decrypt an aes128gcm push body the way a browser does (RFC 8291). */
async function decrypt(
  body: Uint8Array<ArrayBuffer>,
  browser: CryptoKeyPair,
  browserPublic: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const serverPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const serverKey = await crypto.subtle.importKey(
    'raw',
    serverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverKey },
      browser.privateKey,
      256,
    ),
  );
  const info = new Uint8Array([
    ...encoder.encode('WebPush: info\0'),
    ...browserPublic,
    ...serverPublic,
  ]);
  const ikm = await hkdf(auth, shared, info, 32);
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
    'decrypt',
  ]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext,
    ),
  );
  expect(padded[padded.length - 1]).toBe(2);
  return new TextDecoder().decode(padded.slice(0, -1));
}

/** VAPID keys in the base64url form the environment holds them in. */
async function vapid(): Promise<{ keys: VapidKeys; verify: CryptoKey }> {
  const { keys, raw } = await pair('ECDSA');
  const jwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
  return {
    keys: {
      publicKey: base64Url(raw),
      privateKey: jwk.d!,
      subject: 'mailto:ops@example.com',
    },
    verify: keys.publicKey,
  };
}

describe('encryptPayload', () => {
  it('writes one aes128gcm record the browser can decrypt', async () => {
    const browser = await pair('ECDH');
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload(
      { p256dh: base64Url(browser.raw), auth: base64Url(auth) },
      '{"title":"Ready"}',
    );
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(await decrypt(body, browser.keys, browser.raw, auth)).toBe(
      '{"title":"Ready"}',
    );
  });

  it('refuses keys that are not base64url', async () => {
    await expect(
      encryptPayload({ p256dh: 'not base64!', auth: 'AAAA' }, 'x'),
    ).rejects.toThrow('p256dh is not base64url');
  });
});

describe('vapidAuthorization', () => {
  it('signs an ES256 JWT for the push service origin with the public key alongside', async () => {
    const { keys, verify } = await vapid();
    const header = await vapidAuthorization(
      'https://push.example.com/send/abc',
      keys,
      1000,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, k] = match!;
    expect(k).toBe(keys.publicKey);
    expect(
      JSON.parse(new TextDecoder().decode(fromBase64Url(claims!))),
    ).toEqual({
      aud: 'https://push.example.com',
      exp: 1000 + 12 * 60 * 60,
      sub: 'mailto:ops@example.com',
    });
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        verify,
        fromBase64Url(signature!)!,
        encoder.encode(`${head}.${claims}`),
      ),
    ).toBe(true);
  });

  it('refuses a public key that is not an uncompressed point', async () => {
    const { keys } = await vapid();
    await expect(
      vapidAuthorization('https://push.example.com/x', {
        ...keys,
        publicKey: base64Url(new Uint8Array(33)),
      }),
    ).rejects.toThrow('uncompressed');
  });
});

describe('pushRequest', () => {
  it('carries the encoding, a lifetime and the VAPID authorization', async () => {
    const { keys } = await vapid();
    const browser = await pair('ECDH');
    const request = await pushRequest(
      {
        endpoint: 'https://push.example.com/x',
        p256dh: base64Url(browser.raw),
        auth: base64Url(new Uint8Array(16)),
      },
      'hi',
      keys,
      60,
    );
    expect(request.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      TTL: '60',
    });
    expect(request.headers['Authorization']).toMatch(/^vapid t=/);
    expect(request.body.length).toBeGreaterThan(86);
  });
});
