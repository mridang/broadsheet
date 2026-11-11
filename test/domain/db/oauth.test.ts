import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { D1OAuthStore } from '@/domain/db/oauth';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let store: D1OAuthStore;

beforeEach(() => {
  store = new D1OAuthStore(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
});

const grant = {
  id: 'g1',
  userId: 1,
  clientId: 'c1',
  scope: ['read', 'write'],
  resource: 'https://app.test/mcp',
};

describe('D1OAuthStore', () => {
  it('keeps a client with its redirect URIs', async () => {
    const client = {
      clientId: 'c1',
      name: 'A',
      redirectUris: ['https://a/cb'],
    };
    await store.saveClient(client);
    expect(await store.findClient('c1')).toEqual(client);
  });

  it('knows no unregistered client', async () => {
    expect(await store.findClient('nope')).toBeUndefined();
  });

  it('gives a code back only once', async () => {
    const code = {
      codeHash: 'h',
      clientId: 'c1',
      userId: 1,
      redirectUri: 'https://a/cb',
      codeChallenge: 'x',
      scope: ['read'],
      resource: 'https://app.test/mcp',
      expiresAt: 10,
    };
    await store.saveCode(code);
    expect([await store.takeCode('h'), await store.takeCode('h')]).toEqual([
      code,
      undefined,
    ]);
  });

  it('keeps a grant, live until revoked', async () => {
    await store.saveGrant(grant);
    expect(await store.findGrant('g1')).toEqual({ ...grant, revoked: false });
  });

  it('revokes a grant and forgets its tokens', async () => {
    await store.saveGrant(grant);
    await store.saveToken({
      tokenHash: 't',
      kind: 'access',
      grantId: 'g1',
      expiresAt: 10,
    });
    await store.revokeGrant('g1');
    const grantAfter = await store.findGrant('g1');
    expect([grantAfter?.revoked, await store.findToken('t')]).toEqual([
      true,
      undefined,
    ]);
  });

  it('finds a token and gives it back only once when taken', async () => {
    const token = {
      tokenHash: 't',
      kind: 'refresh' as const,
      grantId: 'g1',
      expiresAt: 10,
    };
    await store.saveToken(token);
    expect([
      await store.findToken('t'),
      await store.takeToken('t'),
      await store.takeToken('t'),
    ]).toEqual([token, token, undefined]);
  });

  it('purges only the codes and tokens that expired', async () => {
    const code = {
      codeHash: 'old',
      clientId: 'c1',
      userId: 1,
      redirectUri: 'https://a/cb',
      codeChallenge: 'x',
      scope: ['read'],
      resource: 'https://app.test/mcp',
      expiresAt: 99,
    };
    await store.saveCode(code);
    await store.saveCode({ ...code, codeHash: 'new', expiresAt: 100 });
    await store.saveToken({
      tokenHash: 'old',
      kind: 'access',
      grantId: 'g1',
      expiresAt: 50,
    });
    await store.saveToken({
      tokenHash: 'new',
      kind: 'refresh',
      grantId: 'g1',
      expiresAt: 200,
    });
    expect(await store.purgeExpired(100)).toEqual({ codes: 1, tokens: 1 });
    expect(await store.takeCode('new')).toBeDefined();
    expect(await store.findToken('new')).toBeDefined();
    expect(await store.findToken('old')).toBeUndefined();
  });
});
