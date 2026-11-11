import { beforeEach, describe, expect, it } from '@jest/globals';

import { s256 } from '@/lib/oauth/pkce';
import {
  authenticateAccessToken,
  handleTokenRequest,
  revokeToken,
  type TokenResponse,
} from '@/lib/oauth/token';
import { hashSecret } from '@/lib/oauth/secrets';
import { MemoryStore } from './memory-store';

const ORIGIN = 'https://app.test';
const RESOURCE = 'https://app.test/mcp';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

let store: MemoryStore;

beforeEach(async () => {
  store = new MemoryStore();
  await store.saveCode({
    codeHash: await hashSecret('the-code'),
    clientId: 'c1',
    userId: 7,
    redirectUri: 'https://claude.ai/cb',
    codeChallenge: await s256(VERIFIER),
    scope: ['read'],
    resource: RESOURCE,
    expiresAt: 1060,
  });
});

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

const redeem = (extra: Record<string, string> = {}, now = 1000) =>
  handleTokenRequest(
    form({
      grant_type: 'authorization_code',
      client_id: 'c1',
      code: 'the-code',
      code_verifier: VERIFIER,
      redirect_uri: 'https://claude.ai/cb',
      ...extra,
    }),
    store,
    ORIGIN,
    now,
  );

/** The tokens of a successful redemption. */
async function tokens(): Promise<TokenResponse> {
  const result = await redeem();
  if (!result.ok) throw new Error(result.description);
  return result.tokens;
}

describe('handleTokenRequest with a code', () => {
  it('issues a bearer pair with the approved scope', async () => {
    expect(await tokens()).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read',
    });
  });

  it('redeems a code only once', async () => {
    await redeem();
    expect(await redeem()).toMatchObject({ ok: false, error: 'invalid_grant' });
  });

  it.each([
    [{ code_verifier: `${VERIFIER}x` }],
    [{ client_id: 'c2' }],
    [{ redirect_uri: 'https://claude.ai/other' }],
    [{ resource: 'https://other.test/mcp' }],
  ])('refuses %j', async (extra) => {
    expect(await redeem(extra)).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses an expired code', async () => {
    expect(await redeem({}, 2000)).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses a request with no verifier', async () => {
    expect(
      await handleTokenRequest(
        form({ grant_type: 'authorization_code', client_id: 'c1', code: 'x' }),
        store,
        ORIGIN,
        1000,
      ),
    ).toMatchObject({ error: 'invalid_request' });
  });
});

describe('handleTokenRequest', () => {
  it('needs a client_id', async () => {
    expect(
      await handleTokenRequest(form({}), store, ORIGIN, 1000),
    ).toMatchObject({ error: 'invalid_request' });
  });

  it('refuses another grant type', async () => {
    expect(
      await handleTokenRequest(
        form({ client_id: 'c1', grant_type: 'password' }),
        store,
        ORIGIN,
        1000,
      ),
    ).toMatchObject({ error: 'unsupported_grant_type' });
  });
});

describe('handleTokenRequest with a refresh token', () => {
  const refresh = (token: string, clientId = 'c1') =>
    handleTokenRequest(
      form({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: token,
      }),
      store,
      ORIGIN,
      1100,
    );

  it('issues a new pair', async () => {
    const { refresh_token } = await tokens();
    expect(await refresh(refresh_token)).toMatchObject({ ok: true });
  });

  it('uses a refresh token only once', async () => {
    const { refresh_token } = await tokens();
    await refresh(refresh_token);
    expect(await refresh(refresh_token)).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('refuses another client', async () => {
    const { refresh_token } = await tokens();
    expect(await refresh(refresh_token, 'c2')).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('refuses an access token', async () => {
    const { access_token } = await tokens();
    expect(await refresh(access_token)).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('needs the token', async () => {
    expect(await refresh('')).toMatchObject({ error: 'invalid_request' });
  });
});

describe('authenticateAccessToken', () => {
  it('names the person and scope behind a token', async () => {
    const { access_token } = await tokens();
    expect(
      await authenticateAccessToken(store, access_token, RESOURCE, 1100),
    ).toMatchObject({ userId: 7, scope: ['read'] });
  });

  it('refuses a token for another server', async () => {
    const { access_token } = await tokens();
    expect(
      await authenticateAccessToken(store, access_token, 'https://x/mcp', 1100),
    ).toBeUndefined();
  });

  it('refuses an expired token', async () => {
    const { access_token } = await tokens();
    expect(
      await authenticateAccessToken(store, access_token, RESOURCE, 99_999),
    ).toBeUndefined();
  });

  it('refuses a refresh token', async () => {
    const { refresh_token } = await tokens();
    expect(
      await authenticateAccessToken(store, refresh_token, RESOURCE, 1100),
    ).toBeUndefined();
  });
});

describe('revokeToken', () => {
  it('ends every token of the grant', async () => {
    const { access_token, refresh_token } = await tokens();
    await revokeToken(store, refresh_token, 'c1');
    expect(
      await authenticateAccessToken(store, access_token, RESOURCE, 1100),
    ).toBeUndefined();
  });

  it("leaves another client's token alone", async () => {
    const { access_token } = await tokens();
    await revokeToken(store, access_token, 'c2');
    expect(
      await authenticateAccessToken(store, access_token, RESOURCE, 1100),
    ).toMatchObject({ userId: 7 });
  });

  it('ignores an unknown token', async () => {
    await expect(revokeToken(store, 'nope', 'c1')).resolves.toBeUndefined();
  });
});
