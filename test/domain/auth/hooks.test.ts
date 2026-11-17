import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fixtureUser } from '../fixtures';

const seedDefaults = jest.fn<(userId: number) => Promise<void>>();

// eslint-disable-next-line tslop/no-module-mocking -- the module reads the runtime (cookies or the Cloudflare context), which a test cannot supply, so the test replaces it before importing the code under test
jest.unstable_mockModule('@/domain/account', () => ({ seedDefaults }));

const { OTHER_FLOWS, afterSignIn } = await import('@/domain/auth/hooks');

beforeEach(() => {
  seedDefaults.mockReset();
  seedDefaults.mockResolvedValue();
});

describe('afterSignIn', () => {
  it('gives the person their default feeds', async () => {
    await afterSignIn(fixtureUser({ id: 7 }));
    expect(seedDefaults).toHaveBeenCalledWith(7);
  });

  it('fails the sign-in when the feeds cannot be added', async () => {
    seedDefaults.mockRejectedValue(new Error('boom'));
    await expect(afterSignIn(fixtureUser({ id: 7 }))).rejects.toThrow('boom');
  });
});

describe('OTHER_FLOWS', () => {
  it('has none: signing in is the only ask', () => {
    expect(OTHER_FLOWS).toEqual({});
  });
});
