import { describe, expect, it } from '@jest/globals';

import {
  authorizationServerMetadata,
  isOurResource,
  isProtectedResourcePath,
  protectedResourceMetadata,
  resourceUri,
  wwwAuthenticate,
} from '@/lib/oauth/metadata';

const ORIGIN = 'https://app.test';

describe('resourceUri', () => {
  it('is the MCP endpoint at the root', () => {
    expect(resourceUri(ORIGIN)).toBe('https://app.test/mcp');
  });
});

describe('isOurResource', () => {
  it.each([
    ['https://app.test/mcp', true],
    ['HTTPS://APP.TEST/mcp/', true],
    ['https://app.test/api/mcp', false],
    ['https://app.test/mcp?x=1', false],
    ['https://other.test/mcp', false],
    ['not a url', false],
  ])('%s is %s', (value, expected) => {
    expect(isOurResource(value, ORIGIN)).toBe(expected);
  });
});

describe('isProtectedResourcePath', () => {
  it.each([
    [undefined, true],
    [['mcp'], true],
    [['api', 'mcp'], false],
  ])('%j is %s', (segments, expected) => {
    expect(isProtectedResourcePath(segments)).toBe(expected);
  });
});

describe('the discovery documents', () => {
  it('point the resource at this origin as its own authorization server', () => {
    expect(protectedResourceMetadata(ORIGIN, 'Paper')).toMatchObject({
      resource: 'https://app.test/mcp',
      authorization_servers: [ORIGIN],
      resource_name: 'Paper',
    });
  });

  it('name the OAuth endpoints under /oauth', () => {
    expect(authorizationServerMetadata(ORIGIN)).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: 'https://app.test/oauth/authorize',
      token_endpoint: 'https://app.test/oauth/token',
      registration_endpoint: 'https://app.test/oauth/register',
      revocation_endpoint: 'https://app.test/oauth/revoke',
      code_challenge_methods_supported: ['S256'],
    });
  });
});

describe('wwwAuthenticate', () => {
  it('points at the resource metadata', () => {
    expect(wwwAuthenticate(ORIGIN)).toBe(
      'Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp", scope="read write"',
    );
  });

  it('names an error and the scope needed', () => {
    expect(
      wwwAuthenticate(ORIGIN, { error: 'insufficient_scope', scope: 'write' }),
    ).toBe(
      'Bearer error="insufficient_scope", resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp", scope="write"',
    );
  });
});
