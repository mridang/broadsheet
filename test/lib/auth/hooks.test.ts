import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { User } from '../../../src/lib/repository';

const seedDefaults = jest.fn<(userId: number) => Promise<void>>();

jest.unstable_mockModule('../../../src/lib/account', () => ({ seedDefaults }));

const { OTHER_FLOWS, afterSignIn } =
  await import('../../../src/lib/auth/hooks');

beforeEach(() => {
  seedDefaults.mockReset();
  seedDefaults.mockResolvedValue(undefined);
});

describe('afterSignIn', () => {
  it('gives the person their default feeds', async () => {
    await afterSignIn({ id: 7 } as User);
    expect(seedDefaults).toHaveBeenCalledWith(7);
  });

  it('fails the sign-in when the feeds cannot be added', async () => {
    seedDefaults.mockRejectedValue(new Error('boom'));
    await expect(afterSignIn({ id: 7 } as User)).rejects.toThrow('boom');
  });
});

describe('OTHER_FLOWS', () => {
  it('has none: signing in is the only ask', () => {
    expect(OTHER_FLOWS).toEqual({});
  });
});
