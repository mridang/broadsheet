import { describe, expect, it } from '@jest/globals';

import { isSameOriginPost } from '@/lib/web-security';

const ORIGIN = 'https://chowdown.example';
const headers = (h: Record<string, string>) => new Headers(h);

describe('isSameOriginPost', () => {
  it('accepts a post the browser marks same-origin, even with Origin: null', () => {
    expect(
      isSameOriginPost(
        headers({ 'sec-fetch-site': 'same-origin', origin: 'null' }),
        ORIGIN,
      ),
    ).toBe(true);
  });

  it('refuses cross-site and same-site-but-different-origin posts', () => {
    expect(
      isSameOriginPost(headers({ 'sec-fetch-site': 'cross-site' }), ORIGIN),
    ).toBe(false);
    expect(
      isSameOriginPost(headers({ 'sec-fetch-site': 'same-site' }), ORIGIN),
    ).toBe(false);
  });

  it('trusts Sec-Fetch-Site over a forged-looking Origin', () => {
    expect(
      isSameOriginPost(
        headers({ 'sec-fetch-site': 'cross-site', origin: ORIGIN }),
        ORIGIN,
      ),
    ).toBe(false);
  });

  it('falls back to Origin when the browser sends no Sec-Fetch-Site', () => {
    expect(isSameOriginPost(headers({ origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(
      isSameOriginPost(headers({ origin: 'https://evil.example' }), ORIGIN),
    ).toBe(false);
    expect(isSameOriginPost(headers({}), ORIGIN)).toBe(true);
  });
});
