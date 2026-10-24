import { describe, expect, it } from '@jest/globals';

import {
  base64ToBytes,
  base64UrlToBytes,
  bufferSource,
  bytesToBase64,
  bytesToBase64Url,
} from '@/utils/base64';

describe('base64', () => {
  it('encodes and decodes every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('matches the standard encoding', () => {
    expect(bytesToBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
  });

  it('refuses text that is not base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow();
  });
});

describe('base64 URL-safe', () => {
  it('uses - and _ and leaves off the padding', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xfe, 0x01]);
    expect(bytesToBase64(bytes)).toBe('+//+AQ==');
    expect(bytesToBase64Url(bytes)).toBe('-__-AQ');
  });

  it('round-trips at every padding length', () => {
    for (const length of [0, 1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_, i) => 250 - i);
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('refuses text that is not base64', () => {
    expect(() => base64UrlToBytes('a')).toThrow();
  });
});

describe('bufferSource', () => {
  it('copies the bytes into a fresh array', () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const copy = bufferSource(bytes);
    expect(copy).not.toBe(bytes);
    expect(copy).toEqual(bytes);
  });
});
