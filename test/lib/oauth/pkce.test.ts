import { describe, expect, it } from '@jest/globals';

import { isWellFormedChallenge, s256, verifyPkce } from '@/lib/oauth/pkce';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('s256', () => {
  it('hashes the RFC 7636 example verifier to its challenge', async () => {
    expect(await s256(VERIFIER)).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('verifyPkce', () => {
  it('accepts the verifier of a challenge', async () => {
    expect(await verifyPkce(VERIFIER, await s256(VERIFIER))).toBe(true);
  });

  it('refuses another verifier', async () => {
    expect(await verifyPkce(`${VERIFIER}x`, await s256(VERIFIER))).toBe(false);
  });

  it('refuses a verifier that is too short', async () => {
    expect(await verifyPkce('short', await s256('short'))).toBe(false);
  });
});

describe('isWellFormedChallenge', () => {
  it.each([
    ['E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', true],
    ['too-short', false],
    ['E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM', false],
  ])('%s is %s', (challenge, expected) => {
    expect(isWellFormedChallenge(challenge)).toBe(expected);
  });
});
