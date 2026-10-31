import { describe, expect, it } from '@jest/globals';

import { ACCESS_PREFIX, hashSecret, newSecret } from '@/lib/oauth/secrets';

describe('newSecret', () => {
  it('carries its prefix and 43 base64url characters', () => {
    expect(newSecret(ACCESS_PREFIX)).toMatch(/^bsh_at_[A-Za-z0-9_-]{43}$/);
  });

  it('is different every time', () => {
    expect(newSecret(ACCESS_PREFIX)).not.toBe(newSecret(ACCESS_PREFIX));
  });
});

describe('hashSecret', () => {
  it('is the hex SHA-256', async () => {
    expect(await hashSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
