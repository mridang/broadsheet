import { describe, expect, it, jest } from '@jest/globals';

import {
  D1OAuthStore,
  listConnectedApps,
  oauthSweeps,
  purgeOAuthData,
  resolveClient,
  revokeConnectedApp,
  saveClient,
} from '@/domain/db/oauth';
import { MAX_LIVE_GRANTS_PER_APP, OAUTH_LIMITS } from '@/lib/oauth';
import type { RateLimitStore } from '@/lib/rate-limit';
import { fakeDb } from '../../lib/core/db/fake-db';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteDatabase } from '../../lib/core/db/sqlite-db';
import { quietSecurityLogs } from '../../lib/oauth/quiet-logs';

quietSecurityLogs();

describe('the background sweep reads by index', () => {
  /** The plan of one statement, as one line of text. */
  const planOf = (sql: string) =>
    sqliteDatabase(...APP_MIGRATIONS)
      .raw.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((row) => String(row['detail']))
      .join(' ');

  it('finds revoked grants by their revocation time', () => {
    const plan = planOf("DELETE FROM oauth_grants WHERE revoked_at < 'x'");
    expect(plan).toContain('idx_oauth_grants_revoked_used');
    expect(plan).not.toContain('SCAN');
  });

  it('finds idle grants through the same index', () => {
    const plan = planOf(
      "UPDATE oauth_grants SET revoked_at = 'x' WHERE revoked_at IS NULL AND coalesce(last_used_at, created_at) < 'y'",
    );
    expect(plan).toContain('idx_oauth_grants_revoked_used');
    expect(plan).not.toContain('SCAN');
  });

  it('finds unused registered clients by kind and age', () => {
    const plan = planOf(
      "DELETE FROM oauth_clients WHERE kind = 'dcr' AND created_at < 'x'",
    );
    expect(plan).toContain('idx_oauth_clients_kind_created');
    expect(plan).not.toContain('SCAN');
  });
});

/** A rate-limit store that never refuses. */
const open: RateLimitStore = {
  async hit(_key, now) {
    return { count: 1, windowStart: now };
  },
  async purge() {},
};

/** Dependencies for a lookup that is never rate limited. */
const unlimited = { rateLimits: open };

const CIMD = 'https://app.example/client.json';

/** A registry row for a client. */
const row = (overrides: Record<string, unknown> = {}) => ({
  client_id: 'dcr_abc',
  kind: 'dcr',
  client_name: 'Assistant',
  redirect_uris: '["https://app.example/cb"]',
  created_at: '2026-01-01T00:00:00.000Z',
  fetched_at: null,
  ...overrides,
});

/** A fetch that serves a valid metadata document for `CIMD`. */
const serving = jest.fn(async () =>
  Response.json({
    client_id: CIMD,
    client_name: 'Fresh',
    redirect_uris: ['https://app.example/cb'],
  }),
) as unknown as typeof fetch;

describe('resolveClient', () => {
  it('reads a registered client straight from the registry', async () => {
    const { db } = fakeDb({ findFirst: { oauthClients: row() } });
    expect(await resolveClient(db, 'dcr_abc')).toEqual({
      clientId: 'dcr_abc',
      name: 'Assistant',
      redirectUris: ['https://app.example/cb'],
      kind: 'dcr',
    });
  });

  it('does not know a plain id that was never registered', async () => {
    const { db } = fakeDb({ findFirst: {} });
    expect(await resolveClient(db, 'dcr_nope')).toBeUndefined();
  });

  it('trusts a recently fetched metadata document without fetching again', async () => {
    const fetchImpl = jest.fn(serving);
    const { db } = fakeDb({
      findFirst: {
        oauthClients: row({
          client_id: CIMD,
          kind: 'cimd',
          fetched_at: new Date().toISOString(),
        }),
      },
    });
    expect(await resolveClient(db, CIMD, fetchImpl, unlimited)).toMatchObject({
      kind: 'cimd',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches and saves a metadata document it has not seen', async () => {
    const { db, calls } = fakeDb({ findFirst: {} });
    const client = await resolveClient(db, CIMD, serving, unlimited);
    expect(client).toMatchObject({
      clientId: CIMD,
      name: 'Fresh',
      kind: 'cimd',
    });
    expect(calls.filter((c) => c.statement === 'insert')).not.toHaveLength(0);
  });

  it('refreshes a stale document', async () => {
    const { db } = fakeDb({
      findFirst: {
        oauthClients: row({
          client_id: CIMD,
          kind: 'cimd',
          client_name: 'Old',
          fetched_at: '2020-01-01T00:00:00.000Z',
        }),
      },
    });
    expect(await resolveClient(db, CIMD, serving, unlimited)).toMatchObject({
      name: 'Fresh',
    });
  });

  it('keeps using a stale copy when the client is briefly down', async () => {
    const down = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const { db } = fakeDb({
      findFirst: {
        oauthClients: row({
          client_id: CIMD,
          kind: 'cimd',
          client_name: 'Old',
          fetched_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        }),
      },
    });
    expect(await resolveClient(db, CIMD, down, unlimited)).toMatchObject({
      name: 'Old',
    });
  });

  it('does not know a metadata document it cannot fetch and never saw', async () => {
    const down = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const { db } = fakeDb({ findFirst: {} });
    expect(await resolveClient(db, CIMD, down, unlimited)).toBeUndefined();
  });
});

describe('saveClient', () => {
  it('stores the client and stamps when a metadata document was fetched', async () => {
    const { db, calls } = fakeDb();
    await saveClient(db, {
      clientId: CIMD,
      name: 'Fresh',
      redirectUris: ['https://app.example/cb'],
      kind: 'cimd',
    });
    const values = calls.find((c) => c.method === 'values')?.args[0];
    expect(values).toMatchObject({
      client_id: CIMD,
      kind: 'cimd',
      redirect_uris: '["https://app.example/cb"]',
    });
    expect((values as { fetched_at: unknown }).fetched_at).toEqual(
      expect.any(String),
    );
  });

  it('leaves fetched_at empty for a registered client', async () => {
    const { db, calls } = fakeDb();
    await saveClient(db, {
      clientId: 'dcr_x',
      name: 'X',
      redirectUris: [],
      kind: 'dcr',
    });
    expect(
      (
        calls.find((c) => c.method === 'values')?.args[0] as {
          fetched_at: unknown;
        }
      ).fetched_at,
    ).toBeNull();
  });
});

describe('D1OAuthStore', () => {
  it('finds a code and splits its scope', async () => {
    const { db } = fakeDb({
      findFirst: {
        oauthCodes: {
          client_id: 'c',
          user_id: 7,
          redirect_uri: 'https://app.example/cb',
          redirect_uri_sent: false,
          code_challenge: 'ch',
          scope: 'read write',
          resource: 'r',
          expires_at: 99,
          grant_id: null,
        },
      },
    });
    expect(await new D1OAuthStore(db).findCode('h')).toEqual({
      clientId: 'c',
      userId: 7,
      redirectUri: 'https://app.example/cb',
      redirectUriSent: false,
      codeChallenge: 'ch',
      scope: ['read', 'write'],
      resource: 'r',
      expiresAt: 99,
      grantId: null,
    });
  });

  it('knows no code that is not stored', async () => {
    const { db } = fakeDb({ findFirst: {} });
    expect(await new D1OAuthStore(db).findCode('h')).toBeUndefined();
  });

  it('claims a code only when a row actually changed', async () => {
    expect(
      await new D1OAuthStore(
        fakeDb({ update: [{ meta: { changes: 1 } }] }).db,
      ).claimCode('h', 'g'),
    ).toBe(true);
    expect(
      await new D1OAuthStore(
        fakeDb({ update: [{ meta: { changes: 0 } }] }).db,
      ).claimCode('h', 'g'),
    ).toBe(false);
  });

  it('saves a pair of tokens in one insert', async () => {
    const { db, calls } = fakeDb();
    await new D1OAuthStore(db).saveTokens([
      { hash: 'a', kind: 'access', grantId: 'g', expiresAt: 1 },
      { hash: 'b', kind: 'refresh', grantId: 'g', expiresAt: 2 },
    ]);
    expect(
      calls.filter((c) => c.method === 'values').map((c) => c.args[0]),
    ).toEqual([
      [
        { token_hash: 'a', kind: 'access', grant_id: 'g', expires_at: 1 },
        { token_hash: 'b', kind: 'refresh', grant_id: 'g', expires_at: 2 },
      ],
    ]);
  });

  it('saves nothing for an empty list', async () => {
    const { db, calls } = fakeDb();
    await new D1OAuthStore(db).saveTokens([]);
    expect(calls).toHaveLength(0);
  });

  it('finds a token with its grant', async () => {
    const { db } = fakeDb({
      select: [
        [
          {
            token: { kind: 'refresh', expires_at: 5, used_at: null },
            grant: {
              id: 'g',
              user_id: 7,
              client_id: 'c',
              scope: 'read',
              resource: 'r',
              revoked_at: null,
              last_used_at: '1970-01-01T00:16:40.000Z',
            },
          },
        ],
      ],
    });
    expect(await new D1OAuthStore(db).findToken('h')).toEqual({
      kind: 'refresh',
      expiresAt: 5,
      usedAt: null,
      grant: {
        id: 'g',
        userId: 7,
        clientId: 'c',
        scope: ['read'],
        resource: 'r',
        revoked: false,
        lastUsedAt: 1000,
      },
    });
  });

  it('reads a revoked grant and a never-used one', async () => {
    const { db } = fakeDb({
      select: [
        [
          {
            token: { kind: 'access', expires_at: 5, used_at: 3 },
            grant: {
              id: 'g',
              user_id: 7,
              client_id: 'c',
              scope: 'read',
              resource: 'r',
              revoked_at: '2026-01-01T00:00:00.000Z',
              last_used_at: null,
            },
          },
        ],
      ],
    });
    expect(await new D1OAuthStore(db).findToken('h')).toMatchObject({
      kind: 'access',
      usedAt: 3,
      grant: { revoked: true, lastUsedAt: null },
    });
  });

  it('knows no token that is not stored', async () => {
    const { db } = fakeDb({ select: [[]] });
    expect(await new D1OAuthStore(db).findToken('h')).toBeUndefined();
  });

  const pair = [
    { hash: 'a', kind: 'access', grantId: 'g', expiresAt: 1 },
    { hash: 'b', kind: 'refresh', grantId: 'g', expiresAt: 2 },
  ] as const;

  it('rotates a refresh token in one batch: replacement tokens, then the spent mark', async () => {
    const { db, calls, batches } = fakeDb({
      batch: [[[], { meta: { changes: 1 } }]],
    });
    expect(await new D1OAuthStore(db).rotateRefreshToken('h', 5, pair)).toBe(
      true,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(calls.map((c) => c.statement)).not.toContain('delete');
  });

  it('takes the replacement tokens back when the token was already spent', async () => {
    const { db, calls } = fakeDb({
      batch: [[[], { meta: { changes: 0 } }]],
    });
    expect(await new D1OAuthStore(db).rotateRefreshToken('h', 5, pair)).toBe(
      false,
    );
    expect(calls.some((c) => c.statement === 'delete')).toBe(true);
  });

  it('creates a grant, retires the old one and stores the tokens in one batch', async () => {
    const { db, batches } = fakeDb();
    await new D1OAuthStore(db).createGrant(
      {
        id: 'g',
        userId: 7,
        clientId: 'c',
        scope: ['read'],
        resource: 'r',
      },
      pair,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it('records when a grant was last used, as a timestamp', async () => {
    const { db, calls } = fakeDb();
    await new D1OAuthStore(db).touchGrant('g', 1000);
    expect(calls.find((c) => c.method === 'set')?.args[0]).toEqual({
      last_used_at: '1970-01-01T00:16:40.000Z',
    });
  });
});

describe('listConnectedApps', () => {
  it('names each app, falling back to its client id', async () => {
    const grant = {
      id: 'g1',
      client_id: 'dcr_abc',
      scope: 'read write',
      created_at: '2026-01-01T00:00:00.000Z',
      last_used_at: null,
    };
    const { db } = fakeDb({
      select: [
        [
          { grant, name: 'Claude' },
          { grant: { ...grant, id: 'g2', client_id: 'dcr_xyz' }, name: null },
        ],
      ],
    });
    expect(await listConnectedApps(db, 7)).toEqual([
      {
        grantId: 'g1',
        name: 'Claude',
        scope: ['read', 'write'],
        installs: 1,
        domain: null,
        logoUri: null,
        connectedAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
      },
      expect.objectContaining({ grantId: 'g2', name: 'dcr_xyz' }),
    ]);
  });
});

describe('revokeConnectedApp', () => {
  it('says whether the user had such a grant', async () => {
    expect(
      await revokeConnectedApp(
        fakeDb({ update: [{ meta: { changes: 1 } }] }).db,
        7,
        'g',
      ),
    ).toBe(true);
    expect(
      await revokeConnectedApp(
        fakeDb({ update: [{ meta: { changes: 0 } }] }).db,
        7,
        'g',
      ),
    ).toBe(false);
  });
});

/** A client registry row for seeding. */
function seedClient(
  raw: ReturnType<typeof sqliteDatabase>['raw'],
  id: string,
  kind: string,
  createdAt: string,
  fetchedAt: string | null = null,
  expiresAt: string | null = null,
) {
  raw
    .prepare(
      'INSERT INTO oauth_clients (client_id, kind, client_name, redirect_uris, created_at, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      kind,
      `Name of ${id}`,
      '["https://app.example/cb"]',
      createdAt,
      fetchedAt,
      expiresAt,
    );
}

/** A grant row for seeding. */
function seedGrant(
  raw: ReturnType<typeof sqliteDatabase>['raw'],
  id: string,
  userId: number,
  clientId: string,
  createdAt: string,
  revokedAt: string | null = null,
  lastUsedAt: string | null = null,
  scope = 'read write',
) {
  raw
    .prepare(
      'INSERT INTO oauth_grants (id, user_id, client_id, scope, resource, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, userId, clientId, scope, 'r', createdAt, lastUsedAt, revokedAt);
}

/** The ids of every row in a table, sorted. */
function ids(
  raw: ReturnType<typeof sqliteDatabase>['raw'],
  table: string,
  column: string,
): string[] {
  return raw
    .prepare(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`)
    .all()
    .map((row) => String(row['id']));
}

const MIGRATIONS = [
  '0008_oauth.sql',
  '0012_oauth_housekeeping.sql',
  '0016_oauth_redirect_uri_sent.sql',
  '0017_oauth_client_assertions.sql',
  '0018_oauth_client_logo.sql',
] as const;

// eslint-disable-next-line sonarjs/max-lines-per-function -- one suite over a real SQLite database; splitting it is a large rewrite
describe('against a real SQLite database', () => {
  describe('client authentication', () => {
    const signed = {
      clientId: 'https://chatgpt.com/oauth/client.json',
      name: 'ChatGPT',
      redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      kind: 'cimd' as const,
      auth: {
        method: 'private_key_jwt' as const,
        jwksUri: 'https://chatgpt.com/oauth/jwks.json',
      },
    };

    it('keeps how a client authenticates and where its keys are', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      await saveClient(db, signed, 300);
      expect(await new D1OAuthStore(db).findClient(signed.clientId)).toEqual(
        signed,
      );
    });

    it('treats a client saved without a method as public, and updates it when the document changes', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      const { auth, ...withoutMethod } = signed;
      const { clientId } = signed;
      await saveClient(db, withoutMethod, 300);
      const unsaved = await new D1OAuthStore(db).findClient(clientId);
      expect(unsaved?.auth).toBeUndefined();
      await saveClient(db, signed, 300);
      const saved = await new D1OAuthStore(db).findClient(clientId);
      expect(saved?.auth).toEqual(auth);
    });

    it('answers nothing for a client it does not know', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      expect(await new D1OAuthStore(db).findClient('nobody')).toBeUndefined();
    });

    it('accepts an assertion once and refuses it the second time, per client', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      const store = new D1OAuthStore(db);
      expect(await store.claimAssertion('a', 'jti-1', 99)).toBe(true);
      expect(await store.claimAssertion('a', 'jti-1', 99)).toBe(false);
      expect(await store.claimAssertion('b', 'jti-1', 99)).toBe(true);
    });
  });

  describe('authorization codes', () => {
    const code = (redirectUriSent: boolean) => ({
      clientId: 'c1',
      userId: 7,
      redirectUri: 'https://app.example/cb',
      redirectUriSent,
      codeChallenge: 'ch',
      scope: ['read'],
      resource: 'r',
      expiresAt: 99,
      grantId: null,
    });

    it.each([true, false])(
      'remembers whether the request sent the redirect address (%s)',
      async (sent) => {
        const { db } = sqliteDatabase(...MIGRATIONS);
        const store = new D1OAuthStore(db);
        await store.saveCode('h', code(sent));
        expect(await store.findCode('h')).toMatchObject({
          redirectUriSent: sent,
        });
      },
    );

    it('reads a code saved before the column existed as one whose address was sent', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      raw
        .prepare(
          'INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, 1, ?, ?, ?, ?, 99)',
        )
        .run('old', 'c1', 'u', 'ch', 'read', 'r');
      expect(await new D1OAuthStore(db).findCode('old')).toMatchObject({
        redirectUriSent: true,
      });
    });
  });

  const tokenRows = (...hashes: readonly string[]) =>
    hashes.map((hash, i) => ({
      hash,
      kind: i === 0 ? ('access' as const) : ('refresh' as const),
      grantId: 'new',
      expiresAt: 9_999_999_999,
    }));
  const grantRecord = (id: string, userId = 7, clientId = 'c1') => ({
    id,
    userId,
    clientId,
    scope: ['read'],
    resource: 'r',
  });

  describe('createGrant', () => {
    it("keeps the user's other grants for the same client working, and other users' and clients' too", async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      const store = new D1OAuthStore(db);
      await store.createGrant(grantRecord('laptop'), [
        ...tokenRows('o1', 'o2').map((t) => ({ ...t, grantId: 'laptop' })),
      ]);
      await store.createGrant(grantRecord('other-user', 8), [
        ...tokenRows('u1', 'u2').map((t) => ({ ...t, grantId: 'other-user' })),
      ]);
      await store.createGrant(grantRecord('other-client', 7, 'c2'), [
        ...tokenRows('c1', 'c2').map((t) => ({
          ...t,
          grantId: 'other-client',
        })),
      ]);
      await store.createGrant(
        grantRecord('desktop'),
        tokenRows('n1', 'n2').map((t) => ({ ...t, grantId: 'desktop' })),
      );
      expect(
        raw
          .prepare('SELECT id FROM oauth_grants WHERE revoked_at IS NOT NULL')
          .all(),
      ).toEqual([]);
      for (const token of ['o1', 'n1', 'u1', 'c1']) {
        const found = await store.findToken(token);
        expect(found?.grant.revoked).toBe(false);
      }
    });

    it('retires only the oldest connections beyond the cap', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      const store = new D1OAuthStore(db);
      const made = Array.from(
        { length: MAX_LIVE_GRANTS_PER_APP + 2 },
        (_, i) => `g${String(i).padStart(2, '0')}`,
      );
      // Made in order, so the first ones are the oldest (ids break a tie in the clock).
      for (const id of made) {
        await store.createGrant(grantRecord(id), [
          ...tokenRows(`${id}a`, `${id}b`).map((t) => ({ ...t, grantId: id })),
        ]);
      }
      const revoked = raw
        .prepare(
          'SELECT id FROM oauth_grants WHERE revoked_at IS NOT NULL ORDER BY id',
        )
        .all()
        .map((row) => row['id']);
      expect(revoked).toEqual(made.slice(0, 2));
      expect(
        raw
          .prepare(
            'SELECT COUNT(*) AS n FROM oauth_grants WHERE revoked_at IS NULL',
          )
          .get()?.['n'],
      ).toBe(MAX_LIVE_GRANTS_PER_APP);
    });

    it('does nothing at all if storing the tokens fails', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      const store = new D1OAuthStore(db);
      await store.createGrant(grantRecord('old'), tokenRows('t1', 't2'));
      // A token hash that is already taken makes the last statement fail.
      await expect(
        store.createGrant(grantRecord('new'), tokenRows('t1', 'fresh')),
      ).rejects.toThrow();
      expect(ids(raw, 'oauth_grants', 'id')).toEqual(['old']);
      expect(
        raw.prepare('SELECT revoked_at FROM oauth_grants').get()?.[
          'revoked_at'
        ],
      ).toBeNull();
    });
  });

  describe('rotateRefreshToken', () => {
    const setup = async () => {
      const made = sqliteDatabase(...MIGRATIONS);
      const store = new D1OAuthStore(made.db);
      await store.createGrant(grantRecord('g'), [
        { hash: 'at', kind: 'access', grantId: 'g', expiresAt: 9_999_999_999 },
        { hash: 'rt', kind: 'refresh', grantId: 'g', expiresAt: 9_999_999_999 },
      ]);
      return { ...made, store };
    };
    const replacement = [
      { hash: 'at2', kind: 'access', grantId: 'g', expiresAt: 9_999_999_999 },
      { hash: 'rt2', kind: 'refresh', grantId: 'g', expiresAt: 9_999_999_999 },
    ] as const;

    it('spends the old token and stores the new pair', async () => {
      const { store, raw } = await setup();
      expect(await store.rotateRefreshToken('rt', 500, replacement)).toBe(true);
      const spent = await store.findToken('rt');
      expect(spent?.usedAt).toBe(500);
      expect(ids(raw, 'oauth_tokens', 'token_hash')).toEqual([
        'at',
        'at2',
        'rt',
        'rt2',
      ]);
    });

    it("lets only one of two rotations of the same token win, and keeps only the winner's tokens", async () => {
      const { store, raw } = await setup();
      expect(await store.rotateRefreshToken('rt', 500, replacement)).toBe(true);
      expect(
        await store.rotateRefreshToken('rt', 501, [
          { hash: 'at3', kind: 'access', grantId: 'g', expiresAt: 1 },
          { hash: 'rt3', kind: 'refresh', grantId: 'g', expiresAt: 1 },
        ]),
      ).toBe(false);
      const spent = await store.findToken('rt');
      expect(spent?.usedAt).toBe(500);
      expect(ids(raw, 'oauth_tokens', 'token_hash')).toEqual([
        'at',
        'at2',
        'rt',
        'rt2',
      ]);
    });

    it('does not spend the old token if the replacements cannot be stored', async () => {
      const { store } = await setup();
      await expect(
        store.rotateRefreshToken('rt', 500, [
          { hash: 'at', kind: 'access', grantId: 'g', expiresAt: 1 },
        ]),
      ).rejects.toThrow();
      const kept = await store.findToken('rt');
      expect(kept?.usedAt).toBeNull();
    });
  });

  describe('listConnectedApps and revokeConnectedApp', () => {
    const seed = () => {
      const made = sqliteDatabase(...MIGRATIONS);
      seedClient(made.raw, 'c1', 'dcr', '2026-01-01T00:00:00.000Z');
      seedClient(made.raw, 'c2', 'dcr', '2026-01-01T00:00:00.000Z');
      seedGrant(
        made.raw,
        'g-old',
        7,
        'c1',
        '2026-02-01T00:00:00.000Z',
        null,
        '2026-03-05T00:00:00.000Z',
      );
      seedGrant(made.raw, 'g-new', 7, 'c1', '2026-03-01T00:00:00.000Z');
      seedGrant(made.raw, 'g-other', 7, 'c2', '2026-02-15T00:00:00.000Z');
      seedGrant(made.raw, 'g-theirs', 8, 'c1', '2026-03-02T00:00:00.000Z');
      seedGrant(
        made.raw,
        'g-gone',
        7,
        'c2',
        '2026-01-15T00:00:00.000Z',
        '2026-01-20T00:00:00.000Z',
      );
      return made;
    };

    it('gives a verified app its logo and an unverified app none', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(
        raw,
        'https://a.example/c.json',
        'cimd',
        '2026-01-01T00:00:00.000Z',
      );
      seedClient(raw, 'dcr_b', 'dcr', '2026-01-01T00:00:00.000Z');
      raw.exec(
        "UPDATE oauth_clients SET logo_uri = 'https://a.example/logo.png'",
      );
      seedGrant(
        raw,
        'g-a',
        7,
        'https://a.example/c.json',
        '2026-02-01T00:00:00.000Z',
      );
      seedGrant(raw, 'g-b', 7, 'dcr_b', '2026-01-01T00:00:00.000Z');
      const apps = await listConnectedApps(db, 7);
      expect(apps.map((a) => a.logoUri)).toEqual([
        'https://a.example/logo.png',
        null,
      ]);
    });

    it('lists an app once, newest first, with the latest use of any of its grants', async () => {
      const { db } = seed();
      expect(await listConnectedApps(db, 7)).toEqual([
        {
          grantId: 'g-new',
          name: 'Name of c1',
          scope: ['read', 'write'],
          installs: 2,
          domain: null,
          logoUri: null,
          connectedAt: '2026-03-01T00:00:00.000Z',
          lastUsedAt: '2026-03-05T00:00:00.000Z',
        },
        expect.objectContaining({
          grantId: 'g-other',
          installs: 1,
          lastUsedAt: null,
        }),
      ]);
    });

    it('shows the widest access of any install: an older edit-capable install is not hidden behind a newer read-only one', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(raw, 'c1', 'dcr', '2026-01-01T00:00:00.000Z');
      seedGrant(
        raw,
        'g-edit',
        7,
        'c1',
        '2026-02-01T00:00:00.000Z',
        null,
        null,
        'write',
      );
      seedGrant(
        raw,
        'g-read',
        7,
        'c1',
        '2026-03-01T00:00:00.000Z',
        null,
        null,
        'read',
      );
      expect(await listConnectedApps(db, 7)).toEqual([
        expect.objectContaining({
          grantId: 'g-read',
          scope: ['read', 'write'],
          installs: 2,
        }),
      ]);
    });

    it('names the publishing domain of a metadata-document app, and cleans a name saved before the current rules', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(raw, CIMD, 'cimd', '2026-01-01T00:00:00.000Z');
      raw
        .prepare('UPDATE oauth_clients SET client_name = ?')
        .run('Cl\u202Eaude\n  Desktop');
      seedGrant(raw, 'g1', 7, CIMD, '2026-03-01T00:00:00.000Z');
      expect(await listConnectedApps(db, 7)).toEqual([
        expect.objectContaining({
          name: 'Claude Desktop',
          domain: 'app.example',
        }),
      ]);
    });

    it("disconnects every live grant of the app, and no one else's", async () => {
      const { db, raw } = seed();
      expect(await revokeConnectedApp(db, 7, 'g-new')).toBe(true);
      const live = raw
        .prepare(
          'SELECT id FROM oauth_grants WHERE revoked_at IS NULL ORDER BY id',
        )
        .all()
        .map((row) => row['id']);
      expect(live).toEqual(['g-other', 'g-theirs']);
      const connected = await listConnectedApps(db, 7);
      expect(connected.map((a) => a.grantId)).toEqual(['g-other']);
    });

    it("refuses a grant that is not the user's, and one that does not exist", async () => {
      const { db, raw } = seed();
      expect(await revokeConnectedApp(db, 7, 'g-theirs')).toBe(false);
      expect(await revokeConnectedApp(db, 7, 'nope')).toBe(false);
      expect(
        raw
          .prepare('SELECT revoked_at FROM oauth_grants WHERE id = ?')
          .get('g-theirs')?.['revoked_at'],
      ).toBeNull();
    });

    it('says false for a connection that is already gone', async () => {
      const { db, raw } = seed();
      seedGrant(
        raw,
        'g-solo',
        7,
        'c3',
        '2026-01-15T00:00:00.000Z',
        '2026-01-20T00:00:00.000Z',
      );
      expect(await revokeConnectedApp(db, 7, 'g-solo')).toBe(false);
    });
  });

  describe('purgeOAuthData', () => {
    const NOW = Date.parse('2026-06-01T00:00:00.000Z') / 1000;
    const day = (n: number) =>
      new Date((NOW - n * 86_400) * 1000).toISOString();

    const seed = () => {
      const made = sqliteDatabase(...MIGRATIONS);
      const { raw } = made;
      const code = raw.prepare(
        'INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)',
      );
      code.run('code-old', 'c', 'u', 'ch', 's', 'r', NOW - 2 * 86_400);
      code.run('code-recent', 'c', 'u', 'ch', 's', 'r', NOW - 3600);
      code.run('code-live', 'c', 'u', 'ch', 's', 'r', NOW + 60);
      const assertion = raw.prepare(
        'INSERT INTO oauth_assertions (client_id, jti, expires_at) VALUES (?, ?, ?)',
      );
      assertion.run('c', 'jti-old', NOW - 2 * 86_400);
      assertion.run('c', 'jti-live', NOW + 60);
      seedGrant(raw, 'live', 1, 'granted', day(10));
      seedGrant(raw, 'revoked-recent', 1, 'granted', day(10), day(2));
      seedGrant(raw, 'revoked-today', 1, 'granted', day(10), day(0.5));
      seedGrant(raw, 'revoked-ancient', 1, 'gone', day(200), day(100));
      seedGrant(raw, 'idle', 1, 'granted', day(200), null, day(190));
      seedGrant(raw, 'never-used-old', 1, 'granted', day(200));
      seedGrant(raw, 'old-but-used', 1, 'granted', day(200), null, day(10));
      const token = raw.prepare(
        'INSERT INTO oauth_tokens (token_hash, kind, grant_id, expires_at) VALUES (?, ?, ?, ?)',
      );
      token.run('tok-expired', 'access', 'live', NOW - 2 * 86_400);
      token.run('tok-recent-expiry', 'access', 'live', NOW - 3600);
      token.run('tok-live', 'refresh', 'live', NOW + 86_400);
      token.run(
        'tok-revoked-recent',
        'refresh',
        'revoked-recent',
        NOW + 86_400,
      );
      token.run('tok-revoked-today', 'refresh', 'revoked-today', NOW + 86_400);
      seedClient(raw, 'granted', 'dcr', day(300));
      seedClient(raw, 'gone', 'dcr', day(300));
      seedClient(raw, 'dcr-old-unused', 'dcr', day(31));
      seedClient(raw, 'dcr-week-old-unused', 'dcr', day(8));
      seedClient(raw, 'dcr-new-unused', 'dcr', day(1));
      seedClient(raw, 'cimd-old-unused', 'cimd', day(90), day(31));
      seedClient(raw, 'cimd-recent-unused', 'cimd', day(90), day(2));
      return made;
    };

    it('removes exactly what is stale', async () => {
      const { db, raw } = seed();
      await purgeOAuthData(db, NOW);
      expect(ids(raw, 'oauth_codes', 'code_hash')).toEqual([
        'code-live',
        'code-recent',
      ]);
      expect(ids(raw, 'oauth_tokens', 'token_hash')).toEqual([
        'tok-live',
        'tok-recent-expiry',
        'tok-revoked-today',
      ]);
      expect(ids(raw, 'oauth_assertions', 'jti')).toEqual(['jti-live']);
      expect(ids(raw, 'oauth_grants', 'id')).toEqual([
        'idle',
        'live',
        'never-used-old',
        'old-but-used',
        'revoked-recent',
        'revoked-today',
      ]);
      expect(ids(raw, 'oauth_clients', 'client_id')).toEqual([
        'cimd-recent-unused',
        'dcr-new-unused',
        'dcr-week-old-unused',
        'granted',
      ]);
    });

    it('ends a connection nobody has used for half a year, and one never used since it was made that long ago, but not one in use', async () => {
      const { db, raw } = seed();
      await purgeOAuthData(db, NOW);
      const revoked = raw
        .prepare('SELECT id FROM oauth_grants WHERE revoked_at IS NOT NULL')
        .all()
        .map((row) => row['id']);
      expect(revoked).toEqual(
        expect.arrayContaining(['idle', 'never-used-old']),
      );
      expect(revoked).not.toContain('old-but-used');
      expect(revoked).not.toContain('live');
    });

    it('is safe to run twice', async () => {
      const { db, raw } = seed();
      await purgeOAuthData(db, NOW);
      await purgeOAuthData(db, NOW);
      expect(ids(raw, 'oauth_grants', 'id')).toHaveLength(6);
    });

    it('works without a clock argument', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      await expect(purgeOAuthData(db)).resolves.toBeUndefined();
    });
  });

  describe('resolveClient', () => {
    const NOW = Date.parse('2026-06-01T12:00:00.000Z');
    const ago = (seconds: number) =>
      new Date(NOW - seconds * 1000).toISOString();
    const ahead = (seconds: number) =>
      new Date(NOW + seconds * 1000).toISOString();
    const document = (name = 'Fresh') =>
      JSON.stringify({
        client_id: CIMD,
        client_name: name,
        redirect_uris: ['https://app.example/cb'],
      });
    const serve = (init: ResponseInit = {}) =>
      jest.fn(
        async () => new Response(document(), init),
      ) as unknown as typeof fetch;
    const refusing: RateLimitStore = {
      async hit(_key, now) {
        return { count: 10_000, windowStart: now - 5 };
      },
      async purge() {},
    };

    it('reuses a cached document until its recorded expiry, then fetches again', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(raw, CIMD, 'cimd', ago(900), ago(600), ahead(600));
      const fetchImpl = serve();
      await resolveClient(db, CIMD, fetchImpl, { ...unlimited, now: NOW });
      expect(fetchImpl).not.toHaveBeenCalled();
      await resolveClient(db, CIMD, fetchImpl, {
        ...unlimited,
        now: NOW + 3_600_000,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('records how long to reuse a fetched document, from its cache headers', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      await resolveClient(
        db,
        CIMD,
        serve({ headers: { 'cache-control': 'max-age=1800' } }),
        unlimited,
      );
      const row = raw
        .prepare('SELECT fetched_at, expires_at FROM oauth_clients')
        .get();
      const span =
        Date.parse(String(row?.['expires_at'])) -
        Date.parse(String(row?.['fetched_at']));
      expect(span).toBe(1_800_000);
    });

    it('limits fetches per host and overall, counting them under their own names', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      const keys: string[] = [];
      const counting: RateLimitStore = {
        async hit(key, now) {
          keys.push(key);
          return { count: 1, windowStart: now };
        },
        async purge() {},
      };
      await resolveClient(db, CIMD, serve(), { rateLimits: counting });
      expect(keys).toEqual([
        `${OAUTH_LIMITS.cimdHost.name}:app.example`,
        `${OAUTH_LIMITS.cimdAll.name}:all`,
      ]);
    });

    it('counts the asking address between the host and the overall allowance', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      const keys: string[] = [];
      const counting: RateLimitStore = {
        async hit(key, now) {
          keys.push(key);
          return { count: 1, windowStart: now };
        },
        async purge() {},
      };
      await resolveClient(db, CIMD, serve(), {
        rateLimits: counting,
        address: '203.0.113.7',
      });
      expect(keys).toEqual([
        `${OAUTH_LIMITS.cimdHost.name}:app.example`,
        `${OAUTH_LIMITS.cimdAddress.name}:203.0.113.7`,
        `${OAUTH_LIMITS.cimdAll.name}:all`,
      ]);
    });

    it('does not use up the shared allowance for a caller already over its own', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      const keys: string[] = [];
      const store: RateLimitStore = {
        async hit(key, now) {
          keys.push(key);
          return key.startsWith(OAUTH_LIMITS.cimdAddress.name)
            ? { count: 10_000, windowStart: now }
            : { count: 1, windowStart: now };
        },
        async purge() {},
      };
      expect(
        await resolveClient(db, CIMD, serve(), {
          rateLimits: store,
          address: '203.0.113.7',
        }),
      ).toMatchObject({ busy: true });
      expect(keys.some((k) => k.startsWith(OAUTH_LIMITS.cimdAll.name))).toBe(
        false,
      );
    });

    it('treats an id on this very site as unknown, without a fetch or a limiter hit', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      const fetchImpl = serve();
      const own = 'https://app.example/.well-known/oauth-authorization-server';
      const hits = jest.fn(async () => ({ count: 1, windowStart: 0 }));
      expect(
        await resolveClient(db, own, fetchImpl, {
          rateLimits: { hit: hits, async purge() {} },
          origin: 'https://app.example',
        }),
      ).toBeUndefined();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(hits).not.toHaveBeenCalled();
    });

    it('does not fetch when rate limited, and falls back to a copy under a week old', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(raw, CIMD, 'cimd', ago(86_400), ago(7200), ago(3600));
      const fetchImpl = serve();
      expect(
        await resolveClient(db, CIMD, fetchImpl, {
          rateLimits: refusing,
          now: NOW,
        }),
      ).toMatchObject({ clientId: CIMD, name: `Name of ${CIMD}` });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('answers "busy" when rate limited and there is no usable copy', async () => {
      const { db } = sqliteDatabase(...MIGRATIONS);
      expect(
        await resolveClient(db, CIMD, serve(), {
          rateLimits: refusing,
          now: NOW,
        }),
      ).toEqual({ busy: true, retryAfterSeconds: 55 });
    });

    it('treats a client as unknown when its copy is over a week old and a fresh fetch fails', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(
        raw,
        CIMD,
        'cimd',
        ago(30 * 86_400),
        ago(8 * 86_400),
        ago(8 * 86_400),
      );
      const down = jest.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch;
      expect(
        await resolveClient(db, CIMD, down, { ...unlimited, now: NOW }),
      ).toBeUndefined();
    });

    it('still uses a copy under a week old when a fresh fetch fails', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(
        raw,
        CIMD,
        'cimd',
        ago(30 * 86_400),
        ago(2 * 86_400),
        ago(2 * 86_400),
      );
      const down = jest.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch;
      expect(
        await resolveClient(db, CIMD, down, { ...unlimited, now: NOW }),
      ).toMatchObject({ clientId: CIMD });
    });

    it('looks a registered client up without any fetch or rate limit', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(raw, 'dcr_x', 'dcr', ago(10));
      expect(
        await resolveClient(db, 'dcr_x', serve(), { rateLimits: refusing }),
      ).toMatchObject({ clientId: 'dcr_x', kind: 'dcr' });
    });
  });

  describe('saveClient', () => {
    it('records an expiry for a fetched document and none for a registered client', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      await saveClient(
        db,
        {
          clientId: CIMD,
          name: 'A',
          redirectUris: ['https://app.example/cb'],
          kind: 'cimd',
        },
        600,
      );
      await saveClient(db, {
        clientId: 'dcr_x',
        name: 'B',
        redirectUris: ['https://app.example/cb'],
        kind: 'dcr',
      });
      const rows = raw
        .prepare(
          'SELECT client_id, expires_at FROM oauth_clients ORDER BY client_id',
        )
        .all();
      expect(rows.map((r) => r['expires_at'] === null)).toEqual([true, false]);
    });

    it('keeps the logo a fetched document names, and drops it when the document stops naming one', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      const client = {
        clientId: CIMD,
        name: 'A',
        redirectUris: ['https://app.example/cb'],
        kind: 'cimd' as const,
      };
      const logo = () =>
        raw.prepare('SELECT logo_uri FROM oauth_clients').get()?.['logo_uri'];
      await saveClient(
        db,
        { ...client, logoUri: 'https://app.example/l.png' },
        600,
      );
      expect(logo()).toBe('https://app.example/l.png');
      await saveClient(db, client, 600);
      expect(logo()).toBeNull();
    });

    it('updates the name and expiry of a client it already knows, keeping when it was first seen', async () => {
      const { db, raw } = sqliteDatabase(...MIGRATIONS);
      seedClient(raw, CIMD, 'cimd', '2026-01-01T00:00:00.000Z');
      await saveClient(
        db,
        {
          clientId: CIMD,
          name: 'Renamed',
          redirectUris: ['https://app.example/cb'],
          kind: 'cimd',
        },
        600,
      );
      const row = raw.prepare('SELECT * FROM oauth_clients').get();
      expect(row).toMatchObject({
        client_name: 'Renamed',
        created_at: '2026-01-01T00:00:00.000Z',
      });
      expect(row?.['expires_at']).not.toBeNull();
    });
  });
});

describe('oauthSweeps', () => {
  it('purges OAuth rows, and idle rate-limit counters through the D1 binding', async () => {
    const { db } = sqliteDatabase(...MIGRATIONS);
    const statements: string[] = [];
    const d1 = {
      prepare: (sql: string) => {
        statements.push(sql);
        return { bind: () => ({ run: async () => ({}) }) };
      },
    };
    const sweeps = oauthSweeps(Object.assign(db, { $client: d1 }) as never);
    await sweeps.purgeOAuth();
    await sweeps.purgeRateLimits();
    expect(statements).toEqual([
      'DELETE FROM rate_limits WHERE window_start < ?1',
    ]);
  });
});
