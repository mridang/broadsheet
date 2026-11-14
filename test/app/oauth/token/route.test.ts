import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import type { DatabaseSync } from 'node:sqlite';

import { OPTIONS, POST } from '@/app/oauth/token/route';
import { createDatabase } from '@/domain/db/client';
import { D1OAuthStore } from '@/domain/db/oauth';
import { issueAuthorizationCode, s256 } from '@/lib/oauth';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { quietSecurityLogs } from '../../../lib/oauth/quiet-logs';
import { SCOPE_READ, SCOPE_WRITE } from '@/domain/mcp/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';

const ORIGIN = 'https://app.test';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

quietSecurityLogs();

let raw: DatabaseSync;
let restore: () => void;
let database: ReturnType<typeof createDatabase>;

beforeEach(() => {
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  restore = installCloudflareContext(made.d1);
  database = createDatabase(made.d1);
});

afterEach(() => restore());

/** A fresh authorization code for user 7 and client `client-1`. */
async function newCode(): Promise<string> {
  return issueAuthorizationCode(
    new D1OAuthStore(database),
    {
      clientId: 'client-1',
      userId: 7,
      redirectUri: 'https://app.example/cb',
      redirectUriSent: true,
      codeChallenge: await s256(VERIFIER),
      scope: [SCOPE_READ, SCOPE_WRITE],
      resource: `${ORIGIN}/mcp`,
    },
    Math.floor(Date.now() / 1000),
  );
}

const DEFAULT_CALLER = { 'cf-connecting-ip': '203.0.113.7' };

/** A token request with the given form fields. */
const token = (
  fields: Record<string, string>,
  headers: Record<string, string> = DEFAULT_CALLER,
) =>
  POST(
    new Request(`${ORIGIN}/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams(fields),
      headers,
    }),
  );

/** Redeem a code for a token pair. */
async function redeem(): Promise<Record<string, string>> {
  const res = await token({
    grant_type: 'authorization_code',
    client_id: 'client-1',
    code: await newCode(),
    redirect_uri: 'https://app.example/cb',
    code_verifier: VERIFIER,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, string>;
}

describe('POST /oauth/token', () => {
  it('refuses a code for a client that signs its requests when the request is not signed', async () => {
    raw
      .prepare(
        "INSERT INTO oauth_clients (client_id, kind, client_name, redirect_uris, created_at, auth_method, jwks_uri) VALUES ('client-1', 'cimd', 'Signer', '[\"https://app.example/cb\"]', '2026-01-01T00:00:00.000Z', 'private_key_jwt', 'https://app.example/jwks.json')",
      )
      .run();
    const res = await token({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: await newCode(),
      redirect_uri: 'https://app.example/cb',
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('redeems a code for a token pair, never cached', async () => {
    const res = await token({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: await newCode(),
      redirect_uri: 'https://app.example/cb',
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: `${SCOPE_READ} ${SCOPE_WRITE}`,
    });
  });

  it('answers 400 invalid_grant for a wrong verifier', async () => {
    const res = await token({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: await newCode(),
      redirect_uri: 'https://app.example/cb',
      code_verifier: `${VERIFIER}x`,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('answers 400 invalid_request without a client_id, with no challenge', async () => {
    const res = await token({ grant_type: 'refresh_token' });
    expect(res.status).toBe(400);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('answers 401 invalid_client with a WWW-Authenticate challenge when the client tried a Basic header instead', async () => {
    const res = await token(
      { grant_type: 'refresh_token' },
      { 'cf-connecting-ip': '203.0.113.7', authorization: 'Basic YTpi' },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm=/);
    expect(await res.json()).toMatchObject({ error: 'invalid_client' });
  });

  it('answers 400 invalid_request for a missing grant_type', async () => {
    const res = await token({ client_id: 'client-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('sends Pragma: no-cache with Cache-Control: no-store on every answer', async () => {
    const ok = await token({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: await newCode(),
      redirect_uri: 'https://app.example/cb',
      code_verifier: VERIFIER,
    });
    const refused = await token({ grant_type: 'password', client_id: 'x' });
    for (const res of [ok, refused]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('pragma')).toBe('no-cache');
    }
  });

  it('redeems a code when neither request named the redirect address and the client has one', async () => {
    const code = await issueAuthorizationCode(
      new D1OAuthStore(database),
      {
        clientId: 'client-1',
        userId: 7,
        redirectUri: 'https://app.example/cb',
        redirectUriSent: false,
        codeChallenge: await s256(VERIFIER),
        scope: [SCOPE_READ],
        resource: `${ORIGIN}/mcp`,
      },
      Math.floor(Date.now() / 1000),
    );
    const res = await token({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code,
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /oauth/token, bodies and rate limits', () => {
  it('answers 400 invalid_request for a form over 16 KiB, unread', async () => {
    const res = await token({ client_id: 'c', padding: 'x'.repeat(20_000) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'invalid_request',
      error_description: 'The request is too large.',
    });
  });

  it.each(['multipart/form-data; boundary=x', 'application/json'])(
    'answers 400 invalid_request for a body sent as %s, not a URL-encoded form',
    async (type) => {
      const res = await POST(
        new Request(`${ORIGIN}/oauth/token`, {
          method: 'POST',
          body: 'client_id=client-1',
          headers: { 'content-type': type },
        }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'invalid_request',
        error_description:
          'Send the request as application/x-www-form-urlencoded.',
      });
    },
  );

  it('answers 400 invalid_request for a body that is not UTF-8', async () => {
    const res = await POST(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',

        body: new Uint8Array([0xff, 0xfe]),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('answers 400 unsupported_grant_type for another grant', async () => {
    const res = await token({ grant_type: 'password', client_id: 'client-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  it('rotates a refresh token, and answers a retry with the old one inside the grace window', async () => {
    const first = await redeem();
    const refresh = (value: string) =>
      token({
        grant_type: 'refresh_token',
        client_id: 'client-1',
        refresh_token: value,
      });
    const second = await refresh(first['refresh_token'] ?? '');
    expect(second.status).toBe(200);
    // The client lost that response and asks again with the token it still has.
    const retry = await refresh(first['refresh_token'] ?? '');
    expect(retry.status).toBe(200);
    expect(
      raw
        .prepare(
          'SELECT COUNT(*) AS n FROM oauth_grants WHERE revoked_at IS NULL',
        )
        .get(),
    ).toEqual({ n: 1 });
  });

  it('revokes the grant when a spent refresh token comes back after the grace window', async () => {
    const first = await redeem();
    const refresh = () =>
      token({
        grant_type: 'refresh_token',
        client_id: 'client-1',
        refresh_token: first['refresh_token'] ?? '',
      });
    await refresh();
    // Make the rotation look old by moving its "spent" mark back in time.
    raw
      .prepare(
        'UPDATE oauth_tokens SET used_at = used_at - 3600 WHERE used_at IS NOT NULL',
      )
      .run();
    const late = await refresh();
    expect(late.status).toBe(400);
    expect(await late.json()).toMatchObject({ error: 'invalid_grant' });
    expect(
      raw
        .prepare(
          'SELECT COUNT(*) AS n FROM oauth_grants WHERE revoked_at IS NULL',
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('keeps both connections live when the same app is approved again, as when two devices connect', async () => {
    await redeem();
    await redeem();
    expect(
      raw
        .prepare(
          'SELECT COUNT(*) AS n FROM oauth_grants WHERE revoked_at IS NULL',
        )
        .get(),
    ).toEqual({ n: 2 });
  });

  it('answers 429 with Retry-After when an address asks too often, and counts addresses separately', async () => {
    const hit = (ip: string) =>
      token(
        { grant_type: 'password', client_id: 'c' },
        { 'cf-connecting-ip': ip },
      );
    for (let i = 0; i < 120; i += 1) {
      const refusedAgain = await hit('203.0.113.7');
      expect(refusedAgain.status).toBe(400);
    }
    const limited = await hit('203.0.113.7');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await limited.json()).toMatchObject({
      error: 'temporarily_unavailable',
    });
    const other = await hit('198.51.100.9');
    expect(other.status).toBe(400);
  });
});

describe('OPTIONS /oauth/token', () => {
  it('answers the CORS preflight with 204', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
