import { describe, expect, it, jest } from '@jest/globals';

import {
  AUTHORIZE_FIELDS,
  MAX_CLIENT_ID_LENGTH,
  authorizeParamsFrom,
  grantedScope,
  redirectWith,
  type AuthorizeParams,
  type OAuthClient,
  validateAuthorizeRequest,
} from '@/lib/oauth';

import { quietSecurityLogs } from './quiet-logs';
import { SCOPE_READ, SCOPE_WRITE } from '@/domain/mcp/app';
import urls from '../../fixtures/insecure-urls.json' with { type: 'json' };

const ORIGIN = 'https://site.example';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const client: OAuthClient = {
  clientId: 'dcr_abc',
  name: 'Claude',
  redirectUris: ['https://claude.ai/cb'],
  kind: 'dcr',
};
quietSecurityLogs();

const resolve = async (id: string) =>
  id === client.clientId ? client : undefined;

const good: AuthorizeParams = {
  client_id: 'dcr_abc',
  redirect_uri: 'https://claude.ai/cb',
  response_type: 'code',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'xyz',
};

// An absent parameter: a key set to this overrides the valid default with undefined.
let unset: string | undefined;

const check = (overrides: AuthorizeParams = {}) =>
  validateAuthorizeRequest({ ...good, ...overrides }, ORIGIN, resolve);

describe('validateAuthorizeRequest', () => {
  it('accepts a good request and binds it to this MCP server', async () => {
    const result = await check();
    expect(result).toMatchObject({
      ok: true,
      request: {
        redirectUri: 'https://claude.ai/cb',
        state: 'xyz',
        resource: `${ORIGIN}/mcp`,
        scope: [SCOPE_READ, SCOPE_WRITE],
      },
    });
  });

  it('shows an error, without redirecting, for an unknown client', async () => {
    const result = await check({ client_id: 'nobody' });
    expect(result).toMatchObject({ ok: false, error: 'invalid_client' });
    expect(result.ok === false && result.redirect).toBeFalsy();
  });

  it('shows an error, without redirecting, for a redirect URI the client never registered', async () => {
    const result = await check({ redirect_uri: 'https://evil.example/cb' });
    expect(result).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(result.ok === false && result.redirect).toBeFalsy();
  });

  it('shows an error, without redirecting, for a redirect URI the rules no longer allow', async () => {
    const old: OAuthClient = {
      ...client,
      clientId: 'dcr_old',
      redirectUris: [urls.exampleCallback, 'myapp://cb'],
    };
    for (const uri of old.redirectUris) {
      const result = await validateAuthorizeRequest(
        { ...good, client_id: 'dcr_old', redirect_uri: uri },
        ORIGIN,
        async () => old,
      );
      expect(result).toMatchObject({ ok: false, error: 'invalid_request' });
      expect(result.ok === false && result.redirect).toBeFalsy();
    }
  });

  it('accepts a loopback redirect on any port for a registered loopback address', async () => {
    const local: OAuthClient = {
      ...client,
      redirectUris: ['http://localhost:6274/oauth/callback'],
    };
    const result = await validateAuthorizeRequest(
      { ...good, redirect_uri: 'http://localhost:51234/oauth/callback' },
      ORIGIN,
      async () => local,
    );
    expect(result.ok).toBe(true);
  });

  it('asks the caller to wait, without redirecting, when the client lookup is rate limited', async () => {
    const result = await validateAuthorizeRequest(good, ORIGIN, async () => ({
      busy: true,
      retryAfterSeconds: 17,
    }));
    expect(result).toMatchObject({
      ok: false,
      error: 'temporarily_unavailable',
      retryAfterSeconds: 17,
    });
    expect(result.ok === false && result.redirect).toBeFalsy();
  });

  it('shows an error when there is no client_id', async () => {
    const result = await check({ client_id: unset });
    expect(result).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(result.ok === false && result.redirect).toBeFalsy();
  });

  it('uses the only registered redirect URI when none is sent', async () => {
    const result = await check({ redirect_uri: unset });
    expect(result).toMatchObject({
      ok: true,
      request: { redirectUri: 'https://claude.ai/cb' },
    });
  });

  it('reports other errors to the verified redirect URI, with the state', async () => {
    const result = await check({ response_type: 'token' });
    expect(result).toMatchObject({
      ok: false,
      error: 'unsupported_response_type',
      redirect: { uri: 'https://claude.ai/cb', state: 'xyz' },
    });
  });

  it('requires PKCE with S256', async () => {
    expect(await check({ code_challenge: unset })).toMatchObject({
      ok: false,
      error: 'invalid_request',
    });
    expect(await check({ code_challenge_method: 'plain' })).toMatchObject({
      ok: false,
      error: 'invalid_request',
    });
    expect(await check({ code_challenge: 'short' })).toMatchObject({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('refuses a resource that is not this MCP server', async () => {
    expect(
      await check({ resource: 'https://other.example/mcp' }),
    ).toMatchObject({ ok: false, error: 'invalid_target' });
    expect(await check({ resource: `${ORIGIN}/mcp` })).toMatchObject({
      ok: true,
    });
  });

  it('narrows the scope to what was asked for and rejects unknown-only scopes', async () => {
    expect(await check({ scope: SCOPE_READ })).toMatchObject({
      ok: true,
      request: { scope: [SCOPE_READ] },
    });
    expect(await check({ scope: 'admin' })).toMatchObject({
      ok: false,
      error: 'invalid_scope',
    });
  });
});

describe('which errors may be sent to the redirect address without the person choosing', () => {
  const cimd: OAuthClient = {
    ...client,
    clientId: 'https://claude.ai/oauth/meta.json',
    kind: 'cimd',
  };
  const against = (chosen: OAuthClient) =>
    validateAuthorizeRequest(
      { ...good, client_id: chosen.clientId, response_type: 'token' },
      ORIGIN,
      async () => chosen,
    );

  it('keeps an anonymously registered client away from automatic redirects, so this server cannot be aimed at an address of its choosing', async () => {
    expect(await against(client)).toMatchObject({
      ok: false,
      redirect: { uri: 'https://claude.ai/cb', automatic: false },
    });
  });

  it('allows it for a client whose addresses come from a document its own domain published', async () => {
    expect(await against(cimd)).toMatchObject({
      ok: false,
      redirect: { uri: 'https://claude.ai/cb', automatic: true },
    });
  });
});

describe('what the request said about its redirect address', () => {
  it('knows whether it was sent', async () => {
    expect(await check()).toMatchObject({
      ok: true,
      request: { redirectUriSent: true },
    });
    expect(await check({ redirect_uri: unset })).toMatchObject({
      ok: true,
      request: { redirectUriSent: false },
    });
  });
});

describe('client_id length', () => {
  it('refuses an id longer than the limit before looking anything up', async () => {
    const lookup = jest.fn(async () => client);
    const result = await validateAuthorizeRequest(
      { ...good, client_id: 'x'.repeat(MAX_CLIENT_ID_LENGTH + 1) },
      ORIGIN,
      lookup,
    );
    expect(result).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('security events from the authorization request', () => {
  it('warns about an unknown client, with the id cut short', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ client_id: 'n'.repeat(500) });
    const line = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      event: string;
      clientId: string;
    };
    expect(line.event).toBe('oauth.invalid_client');
    expect(line.clientId).toHaveLength(200);
    warn.mockRestore();
  });

  it('warns when the client lookup is rate limited', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await validateAuthorizeRequest(good, ORIGIN, async () => ({
      busy: true,
      retryAfterSeconds: 9,
    }));
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      event: 'oauth.rate_limited',
      endpoint: 'authorize',
    });
    warn.mockRestore();
  });
});

describe('grantedScope', () => {
  it('grants what was asked unless the person chose read only', () => {
    const asked = [SCOPE_READ, SCOPE_WRITE] as const;
    expect(grantedScope(asked, 'write')).toEqual(asked);
    expect(grantedScope(asked, null)).toEqual(asked);
    expect(grantedScope(asked, undefined)).toEqual(asked);
    expect(grantedScope(asked, 'anything else')).toEqual(asked);
    expect(grantedScope(asked, 'read')).toEqual([SCOPE_READ]);
  });

  it('never grants more than was asked', () => {
    expect(grantedScope([SCOPE_READ], 'write')).toEqual([SCOPE_READ]);
    expect(grantedScope([SCOPE_READ], 'read')).toEqual([SCOPE_READ]);
  });
});

describe('redirectWith', () => {
  it('adds parameters, keeps existing ones and skips undefined', () => {
    const url = redirectWith('https://a.com/cb?keep=1', {
      code: 'abc',
      state: unset,
      iss: ORIGIN,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('keep')).toBe('1');
    expect(parsed.searchParams.get('code')).toBe('abc');
    expect(parsed.searchParams.get('iss')).toBe(ORIGIN);
    expect(parsed.searchParams.has('state')).toBe(false);
  });

  it('works for app-scheme redirect URIs', () => {
    expect(redirectWith('claude://auth/cb', { code: 'abc' })).toContain(
      'code=abc',
    );
  });
});

describe('authorizeParamsFrom', () => {
  it('keeps the authorization parameters that are text, and nothing else', () => {
    const form = new FormData();
    form.append('client_id', 'c');
    form.append('scope', SCOPE_READ);
    form.append('decision', 'approve');
    form.append('resource', new Blob(['x']), 'x.txt');
    expect(authorizeParamsFrom(form)).toEqual({
      client_id: 'c',
      scope: SCOPE_READ,
    });
  });

  it('knows exactly the parameters of an authorization request', () => {
    expect([...AUTHORIZE_FIELDS]).toEqual([
      'client_id',
      'redirect_uri',
      'response_type',
      'state',
      'code_challenge',
      'code_challenge_method',
      'scope',
      'resource',
    ]);
  });
});

describe('error_description is printable ASCII without quotes or backslashes (RFC 6749 4.1.2.1)', () => {
  it.each([
    { client_id: unset },
    { client_id: 'nobody' },
    { redirect_uri: 'https://evil.example/cb' },
    { response_type: 'token' },
    { code_challenge: unset },
    { code_challenge: 'short' },
    { resource: 'https://other.example/mcp' },
    { scope: 'admin' },
  ])('for %j', async (overrides) => {
    const result = await check(overrides);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.description).toMatch(
      /^[\u0020\u0021\u0023-\u005B\u005D-\u007E]+$/,
    );
  });
});
