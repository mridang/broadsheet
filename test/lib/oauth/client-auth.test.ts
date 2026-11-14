import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import {
  SignJWT,
  UnsecuredJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
  type CryptoKey,
} from 'jose';

import {
  CLIENT_ASSERTION_TYPE,
  MAX_ASSERTION_LENGTH,
  MAX_ASSERTION_LIFETIME_SECONDS,
  MAX_JWKS_BYTES,
  assertionSubject,
  fetchJwks,
  verifyClientAssertion,
  type AssertionDeps,
} from '../../../src/lib/oauth/client-auth';

const CLIENT = 'https://chatgpt.com/oauth/client.json';
const JWKS_URI = 'https://chatgpt.com/oauth/jwks.json';
const ENDPOINT = 'https://site.example/oauth/token';
const ISSUER = 'https://site.example';
const NOW = 1_800_000_000;
const AUTH = { method: 'private_key_jwt', jwksUri: JWKS_URI } as const;

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const other = await generateKeyPair('RS256');
  otherKey = other.privateKey;
  jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }],
  };
});

/** Sign an assertion with the client's key; every claim can be overridden or listed in `drop` to be left out. */
function sign(
  claims: Record<string, unknown> = {},
  key: CryptoKey = privateKey,
  alg = 'RS256',
  drop: string[] = [],
) {
  const all: Record<string, unknown> = {
    iss: CLIENT,
    sub: CLIENT,
    aud: ENDPOINT,
    exp: NOW + 60,
    iat: NOW,
    jti: 'jti-1',
    ...claims,
  };
  const jwt = new SignJWT(
    Object.fromEntries(
      Object.entries(all).filter(
        ([k, v]) => v !== undefined && !drop.includes(k),
      ),
    ),
  ).setProtectedHeader({ alg, kid: 'k1' });
  return jwt.sign(key);
}

/** Dependencies that serve `keys` and remember used assertions. */
function deps(keys: unknown = jwks): AssertionDeps & { used: Set<string> } {
  const used = new Set<string>();
  return {
    used,
    fetchJwks: async () => keys,
    claimAssertion: async (client, jti) => {
      const key = `${client} ${jti}`;
      return used.has(key) ? false : (used.add(key), true);
    },
  };
}

const verify = (
  assertion: string | undefined,
  d: AssertionDeps = deps(),
  assertionType: string | undefined = CLIENT_ASSERTION_TYPE,
) =>
  verifyClientAssertion(
    AUTH,
    CLIENT,
    { assertion, assertionType },
    [ENDPOINT, ISSUER],
    d,
    NOW,
  );

describe('verifyClientAssertion', () => {
  it('accepts an assertion signed with the client key', async () => {
    expect(await verify(await sign())).toBeUndefined();
  });

  it.each([ENDPOINT, ISSUER])('accepts the audience %s', async (aud) => {
    expect(await verify(await sign({ aud }))).toBeUndefined();
  });

  it('accepts a list of audiences that includes ours', async () => {
    expect(
      await verify(await sign({ aud: ['https://other.example', ENDPOINT] })),
    ).toBeUndefined();
  });

  it('tolerates a client clock a few seconds fast or slow', async () => {
    expect(await verify(await sign({ exp: NOW - 10 }))).toBeUndefined();
  });

  it.each([
    ['no assertion', undefined, CLIENT_ASSERTION_TYPE],
    ['no assertion type', 'x.y.z', undefined],
    ['another assertion type', 'x.y.z', 'urn:example:saml'],
  ])('refuses a request with %s', async (_name, assertion, type) => {
    const result = await verifyClientAssertion(
      AUTH,
      CLIENT,
      { assertion, assertionType: type },
      [ENDPOINT, ISSUER],
      deps(),
      NOW,
    );
    expect(result).toMatchObject({ ok: false, error: 'invalid_client' });
    expect(result?.description).toMatch(/signed client_assertion/);
  });

  it('refuses an assertion that is too large', async () => {
    const result = await verify('x'.repeat(MAX_ASSERTION_LENGTH + 1));
    expect(result?.description).toMatch(/too large/);
  });

  it('refuses when the client keys cannot be fetched', async () => {
    const result = await verify(await sign(), {
      ...deps(),
      fetchJwks: async () => undefined,
    });
    expect(result?.description).toMatch(/keys could not be fetched/);
  });

  it.each([
    ['signed with another key', () => sign({}, otherKey)],
    ['from another issuer', () => sign({ iss: 'https://evil.example/c.json' })],
    ['about another subject', () => sign({ sub: 'someone-else' })],
    ['for another audience', () => sign({ aud: 'https://evil.example/token' })],
    ['expired', () => sign({ exp: NOW - 120 })],
    ['not yet valid', () => sign({ nbf: NOW + 600 })],
    ['without an expiry', () => sign({}, privateKey, 'RS256', ['exp'])],
    ['without a jti', () => sign({}, privateKey, 'RS256', ['jti'])],
    ['with an empty jti', () => sign({ jti: '' })],
    ['with a jti that is too long', () => sign({ jti: 'j'.repeat(300) })],
    [
      'valid for too long',
      () => sign({ exp: NOW + MAX_ASSERTION_LIFETIME_SECONDS + 60 }),
    ],
    ['not a JWT', async () => 'not-a-jwt'],
    [
      'unsigned (alg none)',
      async () =>
        new UnsecuredJWT({ iss: CLIENT, sub: CLIENT, aud: ENDPOINT, jti: 'j' })
          .setExpirationTime(NOW + 60)
          .encode(),
    ],
  ])('refuses an assertion %s', async (_name, make) => {
    const result = await verify(await make());
    expect(result).toMatchObject({ ok: false, error: 'invalid_client' });
  });

  it('refuses an assertion signed with a shared-secret algorithm', async () => {
    const hmac = await new SignJWT({
      iss: CLIENT,
      sub: CLIENT,
      aud: ENDPOINT,
      exp: NOW + 60,
      jti: 'h',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    expect(await verify(hmac)).toMatchObject({ error: 'invalid_client' });
  });

  it.each([
    ['an empty object', {}],
    ['a list', []],
    ['text', 'keys'],
    ['keys that are not a list', { keys: 'x' }],
    ['no usable key', { keys: [{ kty: 'RSA' }] }],
  ])('refuses when the key set is %s', async (_name, keys) => {
    expect(await verify(await sign(), deps(keys))).toMatchObject({
      error: 'invalid_client',
    });
  });

  it('refuses the same assertion twice, and lets another jti through', async () => {
    const d = deps();
    const assertion = await sign();
    expect(await verify(assertion, d)).toBeUndefined();
    const replay = await verify(assertion, d);
    expect(replay?.description).toMatch(/already used/);
    expect(await verify(await sign({ jti: 'jti-2' }), d)).toBeUndefined();
  });

  it('does not use up a jti on an assertion that did not verify', async () => {
    const d = deps();
    await verify(await sign({}, otherKey), d);
    expect(d.used.size).toBe(0);
  });

  it('keeps a jti until the assertion has expired for good', async () => {
    const claim = jest.fn<AssertionDeps['claimAssertion']>(async () => true);
    await verify(await sign({ exp: NOW + 60 }), {
      ...deps(),
      claimAssertion: claim,
    });
    expect(claim).toHaveBeenCalledWith(CLIENT, 'jti-1', NOW + 60 + 30);
  });
});

describe('fetchJwks', () => {
  const answer = (init: ResponseInit | undefined, body: string) =>
    jest.fn(async () => new Response(body, init)) as unknown as typeof fetch;

  it('reads the key set, without following redirects', async () => {
    const fetchImpl = answer({ status: 200 }, JSON.stringify({ keys: [] }));
    expect(await fetchJwks(JWKS_URI, fetchImpl)).toEqual({ keys: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      JWKS_URI,
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it.each([
    [
      'a redirect',
      { status: 302, headers: { location: 'https://x.example' } },
      '',
    ],
    ['an error', { status: 500 }, 'oops'],
    ['text that is not JSON', { status: 200 }, 'not json'],
    ['a body over the cap', { status: 200 }, 'x'.repeat(MAX_JWKS_BYTES + 1)],
  ])('gives up on %s', async (_name, init, body) => {
    expect(await fetchJwks(JWKS_URI, answer(init, body))).toBeUndefined();
  });

  it('gives up when the request fails', async () => {
    const failing: typeof fetch = jest.fn(() =>
      Promise.reject(new Error('offline')),
    ) as never;
    expect(await fetchJwks(JWKS_URI, failing)).toBeUndefined();
  });
});

describe('assertionSubject', () => {
  it('reads the claimed subject without trusting it', async () => {
    expect(assertionSubject(await sign({}, otherKey))).toBe(CLIENT);
  });

  it.each(['', 'nope', 'a.b.c', 'a.e30.c'])('finds none in %j', (text) => {
    expect(assertionSubject(text)).toBeUndefined();
  });
});
