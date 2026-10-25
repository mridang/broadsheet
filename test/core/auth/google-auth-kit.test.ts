import { describe, expect, it, jest } from '@jest/globals';

import type { User } from '@/domain/auth/store';

const person = { id: 7, email: 'a@b.com' } as User;
const getCurrentUser = jest.fn<() => Promise<User | null>>();

// Mock the specific module and import the kit from its own file: mocking the
// package barrel would replace GoogleAuthKit too.
jest.unstable_mockModule('@/core/auth/current-user', () => ({
  getCurrentUser,
}));

const { GoogleAuthKit } = await import('@/core/auth/google-auth-kit');

/** A kit whose config is irrelevant to the current-user lookup. */
const kit = new GoogleAuthKit({
  scopes: ['openid'],
  stateCookie: 's',
  returnCookie: 'r',
  signInFailedPath: '/login?error=auth',
  signInPurpose: 'signin',
  purposes: ['signin'],
  otherFlows: {},
  completeSignIn: async () => {
    throw new Error('not used');
  },
  missingSignInSettings: () => [],
});

describe('GoogleAuthKit.currentUser', () => {
  it('delegates to the current-user lookup', async () => {
    getCurrentUser.mockResolvedValueOnce(person);
    expect(await kit.currentUser()).toBe(person);

    getCurrentUser.mockResolvedValueOnce(null);
    expect(await kit.currentUser()).toBeNull();
  });
});
