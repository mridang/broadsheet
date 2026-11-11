import { describe, expect, it } from '@jest/globals';

import {
  isAcceptableRedirectUri,
  matchesRegistered,
  redirectWith,
} from '@/lib/oauth/redirect-uri';
import insecure from '../../fixtures/insecure-urls.json';

describe('isAcceptableRedirectUri', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:8765/callback', true],
    ['http://127.0.0.1/cb', true],
    ['com.example.app:/callback', true],
    [insecure.httpEvilCallback, false],
    ['https://claude.ai/cb#frag', false],
    ['javascript:alert(1)', false],
    ['nonsense', false],
  ])('%s is %s', (uri, expected) => {
    expect(isAcceptableRedirectUri(uri)).toBe(expected);
  });
});

describe('matchesRegistered', () => {
  it('matches exactly', () => {
    expect(matchesRegistered('https://a.test/cb', ['https://a.test/cb'])).toBe(
      true,
    );
  });

  it('refuses another path', () => {
    expect(matchesRegistered('https://a.test/x', ['https://a.test/cb'])).toBe(
      false,
    );
  });

  it('lets a loopback address use any port', () => {
    expect(
      matchesRegistered('http://localhost:5555/cb', ['http://localhost/cb']),
    ).toBe(true);
  });
});

describe('redirectWith', () => {
  it('adds the parameters that are set', () => {
    let state: string | undefined;
    expect(redirectWith('https://a.test/cb?x=1', { code: 'c', state })).toBe(
      'https://a.test/cb?x=1&code=c',
    );
  });
});
