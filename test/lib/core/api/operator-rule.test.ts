import { describe, expect, it } from '@jest/globals';

import { isOperator } from '@/lib/core/api/operator-rule';

describe('isOperator', () => {
  it.each([undefined, ''])(
    'lets everyone in where the secret is %j',
    (secret) => {
      expect(isOperator(null, secret)).toBe(true);
      expect(isOperator('Bearer anything', secret)).toBe(true);
    },
  );

  it('lets the exact bearer of the secret in', () => {
    expect(isOperator('Bearer shh', 'shh')).toBe(true);
  });

  it.each([
    null,
    '',
    'shh',
    'bearer shh',
    'Bearer nope',
    'Bearer shh ',
    'Basic shh',
  ])('keeps out %j when a secret is set', (authorization) => {
    expect(isOperator(authorization, 'shh')).toBe(false);
  });
});
