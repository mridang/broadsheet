import { afterEach, describe, expect, it, jest } from '@jest/globals';

/** The secret the mocked Cloudflare environment holds; null means there is no environment at all. */
const environment: { current: { SESSION_SECRET?: string } | null } = {
  current: { SESSION_SECRET: 'test-secret' },
};

jest.unstable_mockModule('../../../src/lib/util', () => ({
  getEnv: () => {
    if (environment.current === null) {
      throw new Error('no context');
    }
    return environment.current;
  },
}));

const { authenticate, mayFetch, signatureFor, signatureValid } =
  await import('../../../src/lib/images/access');

const URL_A = 'https://news.example.org/photo.jpg';
const URL_B = 'https://news.example.org/other.jpg';

afterEach(() => {
  environment.current = { SESSION_SECRET: 'test-secret' };
});

describe('signatures', () => {
  it('are made for a picture address and accepted for exactly that address', () => {
    const signature = signatureFor(URL_A);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(signatureValid(URL_A, signature ?? null)).toBe(true);
  });

  it('are the same every time, so a page and its cache agree', () => {
    expect(signatureFor(URL_A)).toBe(signatureFor(URL_A));
    expect(signatureFor(URL_A)).not.toBe(signatureFor(URL_B));
  });

  it('are refused for another address', () => {
    expect(signatureValid(URL_B, signatureFor(URL_A) ?? null)).toBe(false);
  });

  it.each([null, '', 'forged', 'x'.repeat(43)])('refuse %p', (signature) => {
    expect(signatureValid(URL_A, signature)).toBe(false);
  });

  it('are refused once the secret changes', () => {
    const signature = signatureFor(URL_A) ?? null;
    environment.current = { SESSION_SECRET: 'another-secret' };
    expect(signatureValid(URL_A, signature)).toBe(false);
  });

  it('are neither made nor accepted when no secret is set, rather than using one anyone could guess', () => {
    const signature = signatureFor(URL_A) ?? null;
    for (const none of [{}, { SESSION_SECRET: '' }]) {
      environment.current = none;
      expect(signatureFor(URL_A)).toBeUndefined();
      expect(signatureValid(URL_A, signature)).toBe(false);
    }
    environment.current = { SESSION_SECRET: 'dev-insecure-secret-change-me' };
    expect(signatureValid(URL_A, signature)).toBe(false);
  });

  it('cannot be made or accepted outside a Cloudflare context', () => {
    const signature = signatureFor(URL_A) ?? null;
    environment.current = null;
    expect(signatureFor(URL_A)).toBeUndefined();
    expect(signatureValid(URL_A, signature)).toBe(false);
  });
});

describe('who may ask', () => {
  it('turns nobody away before the signature is looked at', async () => {
    expect(await authenticate()).toBeUndefined();
  });

  it('lets a signed address be fetched', async () => {
    expect(await mayFetch()).toBe(true);
  });
});
