import { describe, expect, it } from '@jest/globals';

import {
  base64Url,
  fromBase64Url,
  hex,
  randomToken,
  sha256Hex,
} from '@/lib/outbound/tokens';

describe('base64Url and fromBase64Url', () => {
  it('round-trips bytes without padding or url-unsafe characters', () => {
    const bytes = new Uint8Array([251, 255, 191, 0, 1]);
    const text = base64Url(bytes);
    expect(text).toBe('-_-_AAE');
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('accepts padded input', () => {
    expect(fromBase64Url('AAE=')).toEqual(new Uint8Array([0, 1]));
  });

  it('refuses text that is not base64url', () => {
    expect(fromBase64Url('a+b/')).toBeUndefined();
    expect(fromBase64Url('a')).toBeUndefined();
  });
});

describe('randomToken', () => {
  it('makes a fresh 43-character token from 32 bytes each time', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
});

describe('hex and sha256Hex', () => {
  it('writes bytes as lowercase hex', () => {
    expect(hex(new Uint8Array([0, 171]).buffer)).toBe('00ab');
  });

  it('hashes text with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
