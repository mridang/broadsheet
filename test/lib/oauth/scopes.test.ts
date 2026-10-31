import { describe, expect, it } from '@jest/globals';

import { hasScope, normaliseScope } from '@/lib/oauth/scopes';

describe('normaliseScope', () => {
  it.each([
    [undefined, ['read', 'write']],
    ['', ['read', 'write']],
    ['read', ['read']],
    ['write offline_access read', ['read', 'write']],
    ['unknown', ['read', 'write']],
  ])('%s becomes %j', (requested, expected) => {
    expect(normaliseScope(requested)).toEqual(expected);
  });
});

describe('hasScope', () => {
  it.each([
    [['read'], 'read', true],
    [['read'], 'write', false],
    [['write'], 'read', true],
    [[], 'read', false],
  ])('%j allows %s: %s', (granted, needed, expected) => {
    expect(hasScope(granted, needed)).toBe(expected);
  });
});
