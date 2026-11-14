import { beforeEach, describe, expect, it } from '@jest/globals';

import { MemoryStore } from './memory-store';
import { quietSecurityLogs, type LogSpy } from './quiet-logs';
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  MAX_LIVE_GRANTS_PER_APP,
  REFRESH_GRACE_SECONDS,
  authenticateAccessToken,
  exchangeAuthorizationCode,
  exchangeRefreshToken as exchangeRefresh,
  hashSecret,
  issueAuthorizationCode,
  revokeToken,
  s256,
  type CodeRecord,
  type OAuthFailure,
  type TokenResponse,
  withinRefreshGrace,
} from '@/lib/oauth';
import { SCOPE_READ, SCOPE_WRITE } from '@/domain/mcp/app';

const RESOURCE = 'https://site.example/mcp';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const NOW = 1_000_000;

/** A value that is deliberately missing, as opposed to a key that is left out. */
let absent: undefined;

const isFailure = (r: TokenResponse | OAuthFailure): r is OAuthFailure =>
  'ok' in r;
const isOurs = (r: string) => r === RESOURCE;

/** Exchange a refresh token, with this suite's idea of "our resource". */
const exchangeRefreshToken = (
  store: MemoryStore,
  request: Parameters<typeof exchangeRefresh>[1],
  now: number,
) => exchangeRefresh(store, request, isOurs, now);

const logs = quietSecurityLogs();

let store: MemoryStore;
let code: string;

async function newCode(overrides: Partial<CodeRecord> = {}) {
  return issueAuthorizationCode(
    store,
    {
      clientId: 'client-1',
      userId: 7,
      redirectUri: 'https://app.example/cb',
      redirectUriSent: true,
      codeChallenge: await s256(VERIFIER),
      scope: [SCOPE_READ, SCOPE_WRITE],
      resource: RESOURCE,
      ...overrides,
    },
    NOW,
  );
}

const redeem = (
  c: string,
  overrides: Record<string, string | undefined> = {},
) =>
  exchangeAuthorizationCode(
    store,
    {
      code: c,
      clientId: 'client-1',
      redirectUri: 'https://app.example/cb',
      codeVerifier: VERIFIER,
      resource: absent,
      ...overrides,
    },
    isOurs,
    NOW + 5,
  );

beforeEach(async () => {
  store = new MemoryStore();
  code = await newCode();
});

describe('issueAuthorizationCode', () => {
  it('stores only a hash of the code, expiring in two minutes', async () => {
    expect(store.codes.has(code)).toBe(false);
    const record = store.codes.get(await hashSecret(code));
    expect(record?.expiresAt).toBe(NOW + CODE_TTL_SECONDS);
    expect(CODE_TTL_SECONDS).toBe(120);
    expect(record?.grantId).toBeNull();
  });
});

describe('exchangeAuthorizationCode', () => {
  it('issues tokens for a valid code and PKCE verifier', async () => {
    const result = await redeem(code);
    expect(isFailure(result)).toBe(false);
    const tokens = result as TokenResponse;
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      scope: `${SCOPE_READ} ${SCOPE_WRITE}`,
    });
    expect(tokens.access_token).toMatch(/^cdn_at_/);
    expect(tokens.refresh_token).toMatch(/^cdn_rt_/);
  });

  it('never stores the tokens themselves, only hashes', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    expect(store.tokens.has(tokens.access_token)).toBe(false);
    expect(store.tokens.has(await hashSecret(tokens.access_token))).toBe(true);
  });

  it('rejects an unknown code', async () => {
    expect(await redeem('cdn_code_bogus')).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
  });

  it('rejects an expired code', async () => {
    const late = await exchangeAuthorizationCode(
      store,
      {
        code,
        clientId: 'client-1',
        redirectUri: 'https://app.example/cb',
        codeVerifier: VERIFIER,
        resource: absent,
      },
      isOurs,
      NOW + CODE_TTL_SECONDS + 1,
    );
    expect(late).toMatchObject({ ok: false, error: 'invalid_grant' });
  });

  it('rejects the wrong PKCE verifier or none', async () => {
    expect(
      await redeem(code, { codeVerifier: `${VERIFIER.slice(1)}x` }),
    ).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(await redeem(code, { codeVerifier: absent })).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
  });

  it('rejects a different client or redirect URI', async () => {
    expect(await redeem(code, { clientId: 'client-2' })).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
    expect(
      await redeem(code, { redirectUri: 'https://evil.example/cb' }),
    ).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(await redeem(code, { redirectUri: absent })).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
  });

  it('rejects a resource that is not this server', async () => {
    expect(
      await redeem(code, { resource: 'https://other.example/mcp' }),
    ).toMatchObject({ ok: false, error: 'invalid_target' });
    expect(isFailure(await redeem(code, { resource: RESOURCE }))).toBe(false);
  });

  it('works only once, and a replay revokes what the first use created', async () => {
    const first = (await redeem(code)) as TokenResponse;
    expect(await redeem(code)).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
    expect(
      await authenticateAccessToken(
        store,
        first.access_token,
        RESOURCE,
        NOW + 10,
      ),
    ).toBeUndefined();
  });
});

describe('authenticateAccessToken', () => {
  it('identifies the user and scopes behind a valid token', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    expect(
      await authenticateAccessToken(
        store,
        tokens.access_token,
        RESOURCE,
        NOW + 10,
      ),
    ).toMatchObject({ userId: 7, scope: [SCOPE_READ, SCOPE_WRITE] });
  });

  it('rejects unknown tokens, refresh tokens and tokens for another resource', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    expect(
      await authenticateAccessToken(store, 'cdn_at_bogus', RESOURCE, NOW + 10),
    ).toBeUndefined();
    expect(
      await authenticateAccessToken(
        store,
        tokens.refresh_token,
        RESOURCE,
        NOW + 10,
      ),
    ).toBeUndefined();
    expect(
      await authenticateAccessToken(
        store,
        tokens.access_token,
        'https://other.example/mcp',
        NOW + 10,
      ),
    ).toBeUndefined();
  });

  it('rejects an expired token', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    expect(
      await authenticateAccessToken(
        store,
        tokens.access_token,
        RESOURCE,
        NOW + 5 + ACCESS_TTL_SECONDS + 1,
      ),
    ).toBeUndefined();
  });

  it('stops working once the grant is revoked', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    await revokeToken(store, tokens.refresh_token);
    expect(
      await authenticateAccessToken(
        store,
        tokens.access_token,
        RESOURCE,
        NOW + 10,
      ),
    ).toBeUndefined();
  });

  it('records use at most every few minutes', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    await authenticateAccessToken(
      store,
      tokens.access_token,
      RESOURCE,
      NOW + 10,
    );
    await authenticateAccessToken(
      store,
      tokens.access_token,
      RESOURCE,
      NOW + 20,
    );
    expect(store.touched).toHaveLength(1);
    await authenticateAccessToken(
      store,
      tokens.access_token,
      RESOURCE,
      NOW + 1000,
    );
    expect(store.touched).toHaveLength(2);
  });
});

// eslint-disable-next-line sonarjs/max-lines-per-function -- one suite covers the whole refresh grant; splitting it is a large restructure
describe('exchangeRefreshToken', () => {
  const refresh = (
    token: string,
    overrides: Record<string, string | undefined> = {},
  ) =>
    exchangeRefreshToken(
      store,
      {
        refreshToken: token,
        clientId: 'client-1',
        scope: absent,
        ...overrides,
      },
      NOW + 100,
    );

  it('rotates: a new pair is issued and the old refresh token is spent', async () => {
    const first = (await redeem(code)) as TokenResponse;
    const second = (await refresh(first.refresh_token)) as TokenResponse;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(
      await authenticateAccessToken(
        store,
        second.access_token,
        RESOURCE,
        NOW + 110,
      ),
    ).toMatchObject({ userId: 7 });
  });

  it('treats reuse of a spent refresh token after the grace window as theft and revokes the grant', async () => {
    const first = (await redeem(code)) as TokenResponse;
    const second = (await refresh(first.refresh_token)) as TokenResponse;
    expect(
      await exchangeRefreshToken(
        store,
        {
          refreshToken: first.refresh_token,
          clientId: 'client-1',
          scope: absent,
        },
        NOW + 100 + REFRESH_GRACE_SECONDS + 1,
      ),
    ).toMatchObject({
      ok: false,
      error: 'invalid_grant',
      description: 'The refresh token was already used.',
    });
    expect(
      await authenticateAccessToken(
        store,
        second.access_token,
        RESOURCE,
        NOW + 110,
      ),
    ).toBeUndefined();
    expect(await refresh(second.refresh_token)).toMatchObject({
      ok: false,
      error: 'invalid_grant',
    });
  });

  describe('grace window', () => {
    const retryAt = (token: string, now: number) =>
      exchangeRefreshToken(
        store,
        { refreshToken: token, clientId: 'client-1', scope: absent },
        now,
      );

    it('answers a retry with the just-rotated token with a fresh pair and keeps the grant', async () => {
      const first = (await redeem(code)) as TokenResponse;
      const lost = (await refresh(first.refresh_token)) as TokenResponse;
      const retry = (await retryAt(
        first.refresh_token,
        NOW + 100 + 5,
      )) as TokenResponse;
      expect(isFailure(retry)).toBe(false);
      expect(retry.refresh_token).not.toBe(lost.refresh_token);
      expect(retry.scope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
      expect(
        await authenticateAccessToken(
          store,
          retry.access_token,
          RESOURCE,
          NOW + 110,
        ),
      ).toMatchObject({ userId: 7 });
      // The pair the client never received is untouched, and the grant lives.
      expect(
        await authenticateAccessToken(
          store,
          lost.access_token,
          RESOURCE,
          NOW + 110,
        ),
      ).toMatchObject({ userId: 7 });
    });

    it('lets the client carry on with the pair from the retry', async () => {
      const first = (await redeem(code)) as TokenResponse;
      await refresh(first.refresh_token);
      const retry = (await retryAt(
        first.refresh_token,
        NOW + 105,
      )) as TokenResponse;
      const next = await retryAt(retry.refresh_token, NOW + 200);
      expect(isFailure(next)).toBe(false);
    });

    it('lasts exactly the grace window, then treats the token as stolen', async () => {
      const first = (await redeem(code)) as TokenResponse;
      await refresh(first.refresh_token);
      const last = await retryAt(
        first.refresh_token,
        NOW + 100 + REFRESH_GRACE_SECONDS,
      );
      expect(isFailure(last)).toBe(false);
      const late = await retryAt(
        first.refresh_token,
        NOW + 100 + REFRESH_GRACE_SECONDS + 1,
      );
      expect(late).toMatchObject({ ok: false, error: 'invalid_grant' });
      expect(store.grants.values().next().value?.revoked).toBe(true);
    });

    it('still refuses a retry from a different client', async () => {
      const first = (await redeem(code)) as TokenResponse;
      await refresh(first.refresh_token);
      expect(
        await exchangeRefreshToken(
          store,
          {
            refreshToken: first.refresh_token,
            clientId: 'client-2',
            scope: absent,
          },
          NOW + 105,
        ),
      ).toMatchObject({ ok: false, error: 'invalid_grant' });
    });

    it('still never widens the scope on a retry', async () => {
      const readOnly = await newCode({ scope: [SCOPE_READ] });
      const first = (await redeem(readOnly)) as TokenResponse;
      await refresh(first.refresh_token);
      expect(
        await exchangeRefreshToken(
          store,
          {
            refreshToken: first.refresh_token,
            clientId: 'client-1',
            scope: SCOPE_WRITE,
          },
          NOW + 105,
        ),
      ).toMatchObject({ ok: false, error: 'invalid_scope' });
    });

    it('answers a parallel refresh that lost the race with its own pair, without revoking', async () => {
      const first = (await redeem(code)) as TokenResponse;
      // The other process rotates the token between our read and our write.
      const racing = new Proxy(store, {
        get(target, property) {
          if (property !== 'rotateRefreshToken') {
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return async (hash: string, now: number) => {
            await target.rotateRefreshToken(hash, now, []);
            return false;
          };
        },
      });
      const result = await exchangeRefreshToken(
        racing,
        {
          refreshToken: first.refresh_token,
          clientId: 'client-1',
          scope: absent,
        },
        NOW + 100,
      );
      expect(isFailure(result as TokenResponse | OAuthFailure)).toBe(false);
      expect(store.grants.values().next().value?.revoked).toBe(false);
    });

    it('revokes when rotation fails and nothing explains why', async () => {
      const first = (await redeem(code)) as TokenResponse;
      const failing = new Proxy(store, {
        get(target, property) {
          if (property === 'rotateRefreshToken') {
            return async () => false;
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const result = await exchangeRefreshToken(
        failing,
        {
          refreshToken: first.refresh_token,
          clientId: 'client-1',
          scope: absent,
        },
        NOW + 100,
      );
      expect(result).toMatchObject({ ok: false, error: 'invalid_grant' });
      expect(store.grants.values().next().value?.revoked).toBe(true);
    });
  });

  it('stores the replacement tokens in the same step that spends the old one', async () => {
    const first = (await redeem(code)) as TokenResponse;
    const before = store.tokens.size;
    await refresh(first.refresh_token);
    expect(store.tokens.size).toBe(before + 2);
  });

  it('rejects an access token, an unknown token and another client', async () => {
    const first = (await redeem(code)) as TokenResponse;
    expect(await refresh(first.access_token)).toMatchObject({ ok: false });
    expect(await refresh('cdn_rt_bogus')).toMatchObject({ ok: false });
    expect(
      await refresh(first.refresh_token, { clientId: 'client-2' }),
    ).toMatchObject({ ok: false, error: 'invalid_grant' });
  });

  it('rejects an expired refresh token', async () => {
    const first = (await redeem(code)) as TokenResponse;
    const result = await exchangeRefreshToken(
      store,
      {
        refreshToken: first.refresh_token,
        clientId: 'client-1',
        scope: absent,
      },
      NOW + 60 * 60 * 24 * 31,
    );
    expect(result).toMatchObject({ ok: false, error: 'invalid_grant' });
  });

  it('never widens the scope', async () => {
    const readOnly = await newCode({ scope: [SCOPE_READ] });
    const first = (await redeem(readOnly)) as TokenResponse;
    expect(
      await refresh(first.refresh_token, {
        scope: `${SCOPE_READ} ${SCOPE_WRITE}`,
      }),
    ).toMatchObject({ ok: false, error: 'invalid_scope' });
  });

  it('reports the whole grant, since tokens are not narrowed one by one', async () => {
    const code = await newCode({ scope: [SCOPE_READ, SCOPE_WRITE] });
    const first = (await redeem(code)) as TokenResponse;
    const second = (await refresh(first.refresh_token, {
      scope: SCOPE_READ,
    })) as TokenResponse;
    expect(second.scope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
  });
});

describe('revokeToken', () => {
  it('ignores an unknown token', async () => {
    await expect(revokeToken(store, 'cdn_at_unknown')).resolves.toBeUndefined();
  });
});

describe('withinRefreshGrace', () => {
  it('is true from the moment of rotation up to the window, and false after', () => {
    expect(withinRefreshGrace(1000, 1000)).toBe(true);
    expect(withinRefreshGrace(1000, 1000 + REFRESH_GRACE_SECONDS)).toBe(true);
    expect(withinRefreshGrace(1000, 1000 + REFRESH_GRACE_SECONDS + 1)).toBe(
      false,
    );
  });

  it('is false for a token that was never used', () => {
    expect(withinRefreshGrace(null, 1000)).toBe(false);
  });
});

describe('several installs of one app', () => {
  it('keeps the earlier grant working when the same user approves the same client again', async () => {
    const first = (await redeem(code)) as TokenResponse;
    const again = (await redeem(await newCode())) as TokenResponse;
    const grants = [...store.grants.values()];
    expect(grants).toHaveLength(2);
    expect(grants.filter((g) => !g.revoked)).toHaveLength(2);
    for (const token of [first, again]) {
      expect(
        await authenticateAccessToken(
          store,
          token.access_token,
          RESOURCE,
          NOW + 10,
        ),
      ).toMatchObject({ userId: 7 });
    }
    expect(
      await exchangeRefreshToken(
        store,
        {
          refreshToken: first.refresh_token,
          clientId: 'client-1',
          scope: absent,
        },
        NOW + 10,
      ),
    ).toHaveProperty('access_token');
  });

  it('retires the oldest grant once the user has more installs than the cap', async () => {
    const tokens: unknown[] = [];
    for (let i = 0; i <= MAX_LIVE_GRANTS_PER_APP; i += 1) {
      tokens.push(await redeem(await newCode()));
    }
    const live = [...store.grants.values()].filter((g) => !g.revoked);
    expect(live).toHaveLength(MAX_LIVE_GRANTS_PER_APP);
    const [oldest] = tokens as TokenResponse[];
    expect(
      await authenticateAccessToken(
        store,
        oldest?.access_token ?? '',
        RESOURCE,
        NOW + 10,
      ),
    ).toBeUndefined();
  });

  it('leaves other users and other clients alone, and the first approval working', async () => {
    const mine = (await redeem(code)) as TokenResponse;
    const otherUser = (await redeem(
      await newCode({ userId: 8 }),
    )) as TokenResponse;
    const otherClient = (await exchangeAuthorizationCode(
      store,
      {
        code: await newCode({ clientId: 'client-2' }),
        clientId: 'client-2',
        redirectUri: 'https://app.example/cb',
        codeVerifier: VERIFIER,
        resource: absent,
      },
      isOurs,
      NOW + 5,
    )) as TokenResponse;
    // Approving again as the first user changes nothing for the others.
    await redeem(await newCode());
    for (const token of [otherUser, otherClient]) {
      expect(
        await authenticateAccessToken(
          store,
          token.access_token,
          RESOURCE,
          NOW + 10,
        ),
      ).toMatchObject({ userId: expect.any(Number) });
    }
    expect(
      await authenticateAccessToken(
        store,
        mine.access_token,
        RESOURCE,
        NOW + 10,
      ),
    ).toMatchObject({ userId: 7 });
  });
});

describe('redirect_uri at the token endpoint (OAuth 2.1 4.1.3)', () => {
  it('is required when the authorization request carried one', async () => {
    const sent = await newCode({ redirectUriSent: true });
    expect(await redeem(sent, { redirectUri: absent })).toMatchObject({
      ok: false,
      error: 'invalid_grant',
      description: 'The redirect_uri does not match the request.',
    });
  });

  it('may be left out when the client let the only registered address stand in', async () => {
    const assumed = await newCode({ redirectUriSent: false });
    const tokens = await redeem(assumed, { redirectUri: absent });
    expect(isFailure(tokens)).toBe(false);
  });

  it('still has to match when it is sent after being assumed', async () => {
    const assumed = await newCode({ redirectUriSent: false });
    expect(
      await redeem(assumed, { redirectUri: 'https://evil.example/cb' }),
    ).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(
      isFailure(
        await redeem(await newCode({ redirectUriSent: false }), {
          redirectUri: 'https://app.example/cb',
        }),
      ),
    ).toBe(false);
  });
});

describe('refresh scope and resource', () => {
  const refreshWith = (
    token: string,
    extra: { scope?: string; resource?: string },
  ) =>
    exchangeRefreshToken(
      store,
      { refreshToken: token, clientId: 'client-1', scope: absent, ...extra },
      NOW + 100,
    );

  it('lets a grant of write refresh with read, which write covers', async () => {
    const first = (await redeem(
      await newCode({ scope: [SCOPE_WRITE] }),
    )) as TokenResponse;
    const second = await refreshWith(first.refresh_token, {
      scope: SCOPE_READ,
    });
    expect(isFailure(second)).toBe(false);
  });

  it('accepts offline_access, which a refresh already is, and refuses unknown scopes', async () => {
    const first = (await redeem(code)) as TokenResponse;
    expect(
      isFailure(
        await refreshWith(first.refresh_token, {
          scope: `${SCOPE_READ} offline_access`,
        }),
      ),
    ).toBe(false);
    const again = (await redeem(await newCode())) as TokenResponse;
    expect(
      await refreshWith(again.refresh_token, { scope: 'admin' }),
    ).toMatchObject({ ok: false, error: 'invalid_scope' });
  });

  it('refuses a resource that is not this server, and accepts ours', async () => {
    const first = (await redeem(code)) as TokenResponse;
    expect(
      await refreshWith(first.refresh_token, {
        resource: 'https://elsewhere.example/mcp',
      }),
    ).toMatchObject({ ok: false, error: 'invalid_target' });
    expect(
      isFailure(await refreshWith(first.refresh_token, { resource: RESOURCE })),
    ).toBe(false);
  });

  it('counts a refresh as use of the grant, so a connection that only refreshes is not taken for idle', async () => {
    const first = (await redeem(code)) as TokenResponse;
    await refreshWith(first.refresh_token, {});
    expect(store.touched).toHaveLength(1);
  });
});

describe('security events', () => {
  const lines = (spy: LogSpy) =>
    spy.mock.calls.map(
      ([line]) => JSON.parse(String(line)) as { event: string },
    );

  it('logs the grant when a code is redeemed, with identifiers and no secret', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    expect(lines(logs.info())).toEqual([
      expect.objectContaining({
        event: 'oauth.grant_created',
        clientId: 'client-1',
        userId: 7,
        scope: `${SCOPE_READ} ${SCOPE_WRITE}`,
      }),
    ]);
    const text = JSON.stringify(logs.info().mock.calls);
    expect(text).not.toContain(tokens.access_token);
    expect(text).not.toContain(tokens.refresh_token);
    expect(text).not.toContain(code);
  });

  it('warns when a used code comes back', async () => {
    await redeem(code);
    await redeem(code);
    expect(lines(logs.warn()).map((l) => l.event)).toEqual([
      'oauth.code_replay_detected',
    ]);
  });

  it('warns when a spent refresh token is replayed after the grace window, and notes a retry inside it', async () => {
    const first = (await redeem(code)) as TokenResponse;
    const rotate = (at: number) =>
      exchangeRefreshToken(
        store,
        {
          refreshToken: first.refresh_token,
          clientId: 'client-1',
          scope: absent,
        },
        at,
      );
    await rotate(NOW + 100);
    await rotate(NOW + 110);
    expect(lines(logs.info()).map((l) => l.event)).toContain(
      'oauth.refresh_grace_retry',
    );
    await rotate(NOW + 100 + REFRESH_GRACE_SECONDS + 1);
    expect(lines(logs.warn())).toEqual([
      expect.objectContaining({ event: 'oauth.refresh_reuse_detected' }),
    ]);
  });

  it('logs a revocation made by the client', async () => {
    const tokens = (await redeem(code)) as TokenResponse;
    await revokeToken(store, tokens.access_token);
    expect(lines(logs.info()).map((l) => l.event)).toContain(
      'oauth.grant_revoked',
    );
  });
});
