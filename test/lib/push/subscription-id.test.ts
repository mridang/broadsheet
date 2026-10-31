import { describe, expect, it } from '@jest/globals';

import {
  endpointForId,
  isSubscriptionId,
  subscriptionId,
} from '@/lib/push/subscription-id';

describe('subscriptionId', () => {
  it('is the lowercase hex SHA-256 of the endpoint', async () => {
    expect(await subscriptionId('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('isSubscriptionId', () => {
  it('accepts exactly 64 lowercase hex digits', async () => {
    expect(isSubscriptionId(await subscriptionId('https://a.test/1'))).toBe(
      true,
    );
  });

  it.each(['', 'abc', 'F'.repeat(64), 'f'.repeat(65), `${'f'.repeat(63)}g`])(
    'refuses %j',
    (id) => {
      expect(isSubscriptionId(id)).toBe(false);
    },
  );
});

describe('endpointForId', () => {
  it('finds the endpoint an id was made from', async () => {
    const id = await subscriptionId('https://b.test/2');
    expect(
      await endpointForId(['https://a.test/1', 'https://b.test/2'], id),
    ).toBe('https://b.test/2');
  });

  it('finds nothing for an id nobody has', async () => {
    expect(await endpointForId(['https://a.test/1'], 'f'.repeat(64))).toBe(
      undefined,
    );
  });
});
