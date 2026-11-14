import { describe, expect, it } from '@jest/globals';

import { isWellFormedChallenge, s256, verifyPkce } from '@/lib/oauth';

// The worked example from RFC 7636 appendix B.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('s256', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await s256(VERIFIER)).toBe(CHALLENGE);
  });
});

describe('verifyPkce', () => {
  it('accepts the matching verifier', async () => {
    expect(await verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
  });

  it('rejects a different verifier', async () => {
    expect(await verifyPkce(`${VERIFIER.slice(1)}x`, CHALLENGE)).toBe(false);
  });

  it('rejects a verifier that is too short or has illegal characters', async () => {
    expect(await verifyPkce('short', await s256('short'))).toBe(false);
    const bad = `${VERIFIER.slice(0, 40)}!!!`;
    expect(await verifyPkce(bad, await s256(bad))).toBe(false);
  });
});

describe('isWellFormedChallenge', () => {
  it('wants exactly 43 url-safe characters', () => {
    expect(isWellFormedChallenge(CHALLENGE)).toBe(true);
    expect(isWellFormedChallenge('abc')).toBe(false);
    expect(isWellFormedChallenge(`${CHALLENGE}=`)).toBe(false);
  });
});
