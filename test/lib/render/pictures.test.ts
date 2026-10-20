import { describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../../../src/lib/util', () => ({
  getEnv: () => ({ SESSION_SECRET: 'test-secret' }),
}));

const { signatureFor } = await import('../../../src/lib/images/access');
const { pictureSrc } = await import('../../../src/lib/render/pictures');

const ARTICLE = 'https://news.example.org/photo.jpg';
const FAVICON = 'https://www.google.com/s2/favicons?sz=64&domain=example.org';

describe('pictureSrc', () => {
  it('routes a picture through our own signed image proxy', () => {
    const src = pictureSrc(ARTICLE, 480);
    expect(src).toContain('/api/img?url=');
    const params = new URL(src ?? '', 'https://app.test').searchParams;
    expect(params.get('url')).toBe(ARTICLE);
    expect(params.get('w')).toBe('480');
    expect(params.get('sig')).toBeTruthy();
    expect(params.get('sig')).toBe(signatureFor(ARTICLE));
  });

  it('routes a favicon through it too', () => {
    const params = new URL(pictureSrc(FAVICON, 64) ?? '', 'https://app.test')
      .searchParams;
    expect(params.get('url')).toBe(FAVICON);
    expect(params.get('w')).toBe('64');
  });

  it('snaps the width to one the proxy offers', () => {
    expect(pictureSrc(ARTICLE, 500)).toContain('&w=600');
  });

  it.each([
    '',
    '/relative.jpg',
    '//cdn.example.org/a.jpg',
    'http://127.0.0.1/a.jpg',
    'javascript:alert(1)',
    'not a url',
  ])('shows no picture for %p', (src) => {
    expect(pictureSrc(src, 480)).toBeNull();
  });
});
