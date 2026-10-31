import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  authorizeParamsFrom,
  issueAuthorizationCode,
  validateAuthorizeRequest,
  type AuthorizeParams,
} from '@/lib/oauth/authorize';
import { hashSecret } from '@/lib/oauth/secrets';
import { MemoryStore } from './memory-store';

const ORIGIN = 'https://app.test';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let store: MemoryStore;

beforeEach(async () => {
  store = new MemoryStore();
  await store.saveClient({
    clientId: 'c1',
    name: 'Claude',
    redirectUris: ['https://claude.ai/cb'],
  });
});

const params = (extra: AuthorizeParams = {}): AuthorizeParams => ({
  response_type: 'code',
  client_id: 'c1',
  redirect_uri: 'https://claude.ai/cb',
  state: 's',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  ...extra,
});

const check = (p: AuthorizeParams) =>
  validateAuthorizeRequest(p, ORIGIN, (id) => store.findClient(id));

describe('validateAuthorizeRequest', () => {
  it('accepts a complete request, for this MCP server and every scope', async () => {
    const result = await check(params());
    expect(result.ok && result.request).toMatchObject({
      redirectUri: 'https://claude.ai/cb',
      state: 's',
      scope: ['read', 'write'],
      resource: 'https://app.test/mcp',
    });
  });

  it('uses the only registered redirect URI when none is sent', async () => {
    const result = await check(params({ redirect_uri: undefined }));
    expect(result.ok && result.request.redirectUri).toBe(
      'https://claude.ai/cb',
    );
  });

  it('refuses an unknown client without redirecting', async () => {
    const result = await check(params({ client_id: 'nope' }));
    expect(result).toEqual({
      ok: false,
      error: 'invalid_client',
      description: 'This app is not registered here.',
    });
  });

  it('refuses an unregistered redirect URI without redirecting', async () => {
    const result = await check(params({ redirect_uri: 'https://evil.test' }));
    expect(!result.ok && result.redirect).toBeUndefined();
  });

  it.each([
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge: undefined }, 'invalid_request'],
    [{ code_challenge_method: 'plain' }, 'invalid_request'],
    [{ resource: 'https://other.test/mcp' }, 'invalid_target'],
  ])('reports %j to the app as %s', async (extra, error) => {
    const result = await check(params(extra));
    expect(!result.ok && [result.error, result.redirect]).toEqual([
      error,
      { uri: 'https://claude.ai/cb', state: 's' },
    ]);
  });
});

describe('authorizeParamsFrom', () => {
  it('reads only the authorization fields', () => {
    const form = new URLSearchParams('client_id=c1&decision=approve');
    expect(authorizeParamsFrom(form)).toMatchObject({
      client_id: 'c1',
      state: undefined,
    });
  });
});

describe('issueAuthorizationCode', () => {
  it('stores only the hash of the code, expiring in a minute', async () => {
    const result = await check(params());
    if (!result.ok) throw new Error('expected a valid request');
    const code = await issueAuthorizationCode(store, result.request, 7, 1000);
    expect(store.codes.get(await hashSecret(code))).toMatchObject({
      userId: 7,
      clientId: 'c1',
      expiresAt: 1060,
    });
  });
});
