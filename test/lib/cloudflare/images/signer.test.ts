import { describe, expect, it } from '@jest/globals';

import { ImageSigner } from '@/lib/cloudflare/images';

const URL_A = 'https://news.example.org/photo.jpg';
const URL_B = 'https://news.example.org/other.jpg';

const signer = new ImageSigner('test-secret');

describe('ImageSigner', () => {
  it('signs a picture address and accepts the signature for exactly that address', async () => {
    const signature = await signer.sign(URL_A);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await signer.verify(URL_A, signature)).toBe(true);
  });

  it('is the same every time, so a page and its cache agree', async () => {
    expect(await signer.sign(URL_A)).toBe(await signer.sign(URL_A));
    expect(await signer.sign(URL_A)).not.toBe(await signer.sign(URL_B));
  });

  it('refuses a signature made for another address', async () => {
    expect(await signer.verify(URL_B, await signer.sign(URL_A))).toBe(false);
  });

  it.each([null, '', 'forged', 'x'.repeat(43)])(
    'refuses %p',
    async (signature) => {
      expect(await signer.verify(URL_A, signature)).toBe(false);
    },
  );

  it('refuses a signature made under a different secret', async () => {
    const signature = await new ImageSigner('another-secret').sign(URL_A);
    expect(await signer.verify(URL_A, signature)).toBe(false);
  });
});
