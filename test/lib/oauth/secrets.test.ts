import { describe, expect, it } from '@jest/globals';

import { hashSecret, newSecret } from '@/lib/oauth';

describe('newSecret', () => {
  it('is prefixed, url-safe and different every time', () => {
    const a = newSecret('cdn_at');
    const b = newSecret('cdn_at');
    expect(a).toMatch(/^cdn_at_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe('hashSecret', () => {
  it('is a stable 64-character hex digest that is not the secret', async () => {
    const hash = await hashSecret('cdn_at_example');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashSecret('cdn_at_example'));
    expect(hash).not.toContain('example');
  });

  it('differs for different secrets', async () => {
    expect(await hashSecret('a')).not.toBe(await hashSecret('b'));
  });
});
