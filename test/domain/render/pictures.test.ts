import { describe, expect, it } from '@jest/globals';

import { ImageSigner } from '@/lib/cloudflare/images';
import { pictureSrc } from '@/domain/render/pictures';

const signer = new ImageSigner('test-secret');

const ARTICLE = 'https://news.example.org/photo.jpg';
const FAVICON = 'https://www.google.com/s2/favicons?sz=64&domain=example.org';

describe('pictureSrc', () => {
  it('routes a picture through our own signed image proxy', async () => {
    const src = await pictureSrc(ARTICLE, 480, signer);
    expect(src).toContain('/img?url=');
    const params = new URL(src ?? '', 'https://app.test').searchParams;
    expect(params.get('url')).toBe(ARTICLE);
    expect(params.get('w')).toBe('480');
    expect(params.get('sig')).toBeTruthy();
    expect(params.get('sig')).toBe(await signer.sign(ARTICLE));
  });

  it('carries no signature when there is no signer', async () => {
    const params = new URL(
      (await pictureSrc(ARTICLE, 480)) ?? '',
      'https://app.test',
    ).searchParams;
    expect(params.get('sig')).toBeNull();
    expect(params.get('url')).toBe(ARTICLE);
  });

  it('routes a favicon through it too', async () => {
    const params = new URL(
      (await pictureSrc(FAVICON, 64, signer)) ?? '',
      'https://app.test',
    ).searchParams;
    expect(params.get('url')).toBe(FAVICON);
    expect(params.get('w')).toBe('64');
  });

  it('snaps the width to one the proxy offers', async () => {
    expect(await pictureSrc(ARTICLE, 500, signer)).toContain('&w=600');
  });

  it.each([
    '',
    '/relative.jpg',
    '//cdn.example.org/a.jpg',
    'http://127.0.0.1/a.jpg',
    'javascript:alert(1)',
    'not a url',
  ])('shows no picture for %p', async (src) => {
    expect(await pictureSrc(src, 480, signer)).toBeNull();
  });
});
