import { describe, expect, it } from '@jest/globals';

import {
  authorizationServerMetadata,
  isOurResource,
  isProtectedResourcePath,
  protectedResourceMetadata,
  resourceUri,
  wwwAuthenticate,
} from '@/lib/oauth';
import { SCOPE_READ, SCOPE_WRITE } from '@/domain/mcp/app';
import urls from '../../fixtures/insecure-urls.json' with { type: 'json' };

const ORIGIN = 'https://site.example';

describe('resource and issuer', () => {
  it('names the MCP endpoint as the resource', () => {
    expect(resourceUri(ORIGIN)).toBe(`${ORIGIN}/mcp`);
  });

  it('accepts the resource with or without a trailing slash, nothing else', () => {
    expect(isOurResource(`${ORIGIN}/mcp`, ORIGIN)).toBe(true);
    expect(isOurResource(`${ORIGIN}/mcp/`, ORIGIN)).toBe(true);
    expect(isOurResource(`${ORIGIN}/api/other`, ORIGIN)).toBe(false);
    expect(isOurResource('https://evil.example/mcp', ORIGIN)).toBe(false);
  });

  it('accepts an upper-case scheme or host, which is the same address', () => {
    expect(isOurResource('HTTPS://Site.Example/mcp', ORIGIN)).toBe(true);
    expect(isOurResource('https://SITE.EXAMPLE/mcp/', ORIGIN)).toBe(true);
  });

  it('refuses a resource with a query or fragment, another scheme or port, or no URL at all', () => {
    expect(isOurResource(`${ORIGIN}/mcp?x=1`, ORIGIN)).toBe(false);
    expect(isOurResource(`${ORIGIN}/mcp#frag`, ORIGIN)).toBe(false);
    expect(isOurResource(urls.siteExampleMcp, ORIGIN)).toBe(false);
    expect(isOurResource('https://site.example:8443/mcp', ORIGIN)).toBe(false);
    expect(isOurResource('not a url', ORIGIN)).toBe(false);
    expect(isOurResource(`${ORIGIN}/mcp/extra`, ORIGIN)).toBe(false);
  });
});

describe('isProtectedResourcePath', () => {
  it('answers for the bare well-known path and for the MCP endpoint path', () => {
    expect(isProtectedResourcePath(undefined)).toBe(true);
    expect(isProtectedResourcePath([])).toBe(true);
    expect(isProtectedResourcePath(['mcp'])).toBe(true);
  });

  it('has no document for any other path', () => {
    expect(isProtectedResourcePath(['anything'])).toBe(false);
    expect(isProtectedResourcePath(['api'])).toBe(false);
    expect(isProtectedResourcePath(['mcp', 'more'])).toBe(false);
    expect(isProtectedResourcePath(['api', 'other'])).toBe(false);
  });
});

describe('protectedResourceMetadata', () => {
  it('points at this origin as its own authorization server', () => {
    const doc = protectedResourceMetadata(ORIGIN);
    expect(doc.resource).toBe(`${ORIGIN}/mcp`);
    expect(doc.authorization_servers).toEqual([ORIGIN]);
    expect(doc.bearer_methods_supported).toEqual(['header']);
  });
});

describe('authorizationServerMetadata', () => {
  const doc = authorizationServerMetadata(ORIGIN);

  it('advertises every endpoint on this origin', () => {
    expect(doc.issuer).toBe(ORIGIN);
    expect(doc.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(doc.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(doc.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(doc.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
  });

  it('requires PKCE S256 and offers public clients and signed assertions', () => {
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
    expect(doc.token_endpoint_auth_methods_supported).toEqual([
      'none',
      'private_key_jwt',
    ]);
    expect(doc.token_endpoint_auth_signing_alg_values_supported).toEqual([
      'RS256',
      'PS256',
      'ES256',
    ]);
  });

  it('says revocation takes public clients only', () => {
    expect(doc.revocation_endpoint_auth_methods_supported).toEqual(['none']);
  });

  it('advertises offline_access, because every grant gets a refresh token', () => {
    expect(doc.scopes_supported).toEqual([
      SCOPE_READ,
      SCOPE_WRITE,
      'offline_access',
    ]);
    expect(doc.grant_types_supported).toContain('refresh_token');
  });

  it('keeps offline_access out of the resource metadata and the challenge', () => {
    expect(protectedResourceMetadata(ORIGIN).scopes_supported).not.toContain(
      'offline_access',
    );
    expect(wwwAuthenticate(ORIGIN)).not.toContain('offline_access');
  });

  it('supports metadata-document clients and the iss parameter', () => {
    expect(doc.client_id_metadata_document_supported).toBe(true);
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });
});

describe('wwwAuthenticate', () => {
  it('points an unauthenticated client at the metadata and asks for all scopes', () => {
    const header = wwwAuthenticate(ORIGIN);
    expect(header).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(header).toContain(`scope="${SCOPE_READ} ${SCOPE_WRITE}"`);
    expect(header.startsWith('Bearer ')).toBe(true);
  });

  it('reports an error and the scope an operation needs', () => {
    const header = wwwAuthenticate(ORIGIN, {
      error: 'insufficient_scope',
      scope: SCOPE_WRITE,
    });
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain(`scope="${SCOPE_WRITE}"`);
  });
});
