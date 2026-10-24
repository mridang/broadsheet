import { describe, expect, it } from '@jest/globals';

import {
  SIGN_IN_PURPOSE,
  checkState,
  newState,
  purposeOf,
} from '@/lib/web-security/oauth-state';

/** A sample set of valid labels, as a caller would pass in (sign-in plus one extra). */
const PURPOSES = [SIGN_IN_PURPOSE, 'extra'];

describe('newState', () => {
  it.each(PURPOSES)(
    'names its purpose (%s) and is different every time',
    (purpose) => {
      expect(newState(purpose)).toMatch(
        new RegExp(`^${purpose}\\.[0-9a-f-]{36}$`),
      );
      expect(newState(purpose)).not.toBe(newState(purpose));
    },
  );
});

describe('purposeOf', () => {
  it.each(PURPOSES)('reads the purpose (%s) back out', (purpose) => {
    expect(purposeOf(newState(purpose), PURPOSES)).toBe(purpose);
  });

  it('refuses anything that is not one of the valid labels', () => {
    expect(purposeOf('', PURPOSES)).toBeUndefined();
    expect(purposeOf(SIGN_IN_PURPOSE, PURPOSES)).toBeUndefined();
    expect(purposeOf(`${SIGN_IN_PURPOSE}.`, PURPOSES)).toBeUndefined();
    expect(purposeOf('admin.123', PURPOSES)).toBeUndefined();
    expect(
      purposeOf('123e4567-e89b-12d3-a456-426614174000', PURPOSES),
    ).toBeUndefined();
  });
});

describe('checkState', () => {
  it.each(PURPOSES)(
    'trusts a state that matches the cookie and names its purpose (%s)',
    (purpose) => {
      const state = newState(purpose);
      expect(checkState(state, state, PURPOSES)).toEqual({ ok: true, purpose });
    },
  );

  it('stops when either side is missing', () => {
    const state = newState(SIGN_IN_PURPOSE);
    expect(checkState(null, state, PURPOSES)).toEqual({
      ok: false,
      claimed: undefined,
    });
    expect(checkState(state, undefined, PURPOSES)).toEqual({
      ok: false,
      claimed: SIGN_IN_PURPOSE,
    });
    expect(checkState('', '', PURPOSES)).toEqual({
      ok: false,
      claimed: undefined,
    });
  });

  it('stops when the two differ, still reporting the label for the wording', () => {
    expect(
      checkState(
        newState(SIGN_IN_PURPOSE),
        newState(SIGN_IN_PURPOSE),
        PURPOSES,
      ),
    ).toEqual({ ok: false, claimed: SIGN_IN_PURPOSE });
  });

  it('stops for a matching state that is not one of the valid labels', () => {
    expect(checkState('admin.123', 'admin.123', PURPOSES)).toEqual({
      ok: false,
      claimed: undefined,
    });
  });
});
