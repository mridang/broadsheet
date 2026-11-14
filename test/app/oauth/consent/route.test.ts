import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import type { DatabaseSync } from 'node:sqlite';

import { handleConsent } from '@/app/oauth/consent/handler';
import type { CurrentUserResolver } from '@/domain/api/auth';
import { s256 } from '@/lib/oauth';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { quietSecurityLogs } from '../../../lib/oauth/quiet-logs';
import { SCOPE_READ, SCOPE_WRITE } from '@/domain/mcp/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import urls from '../../../fixtures/insecure-urls.json' with { type: 'json' };

/** Who is signed in; null means nobody. */
/** `ended`: the person signed out everywhere, though the cookie itself still verifies. */
const session: { uid: number | null; ended: boolean } = {
  uid: 7,
  ended: false,
};

/** Identity injected in place of the session cookie. */
const resolver: CurrentUserResolver = {
  currentUid: async () => session.uid,
  currentLiveUid: async () => (session.ended ? null : session.uid),
  currentUser: async () => null,
};

const ORIGIN = 'https://app.test';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

quietSecurityLogs();

let raw: DatabaseSync;
let restore: () => void;
let challenge: string;

beforeEach(async () => {
  session.uid = 7;
  session.ended = false;
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  restore = installCloudflareContext(made.d1);
  challenge = await s256(VERIFIER);
  raw
    .prepare(
      'INSERT INTO oauth_clients (client_id, kind, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'dcr_abc',
      'dcr',
      'Assistant',
      JSON.stringify([
        'https://app.example/cb',
        'http://localhost:6274/oauth/callback',
        urls.exampleOld,
      ]),
      '2026-01-01T00:00:00.000Z',
    );
});

afterEach(() => restore());

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };

/** A consent form post with the usual fields, overridable. */
function consent(
  fields: Record<string, string | undefined> = {},
  headers: Record<string, string> = SAME_ORIGIN,
): Promise<Response> {
  const form = new URLSearchParams(
    Object.entries<string | undefined>({
      client_id: 'dcr_abc',
      redirect_uri: 'https://app.example/cb',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      decision: 'approve',
      ...fields,
    }).flatMap(([k, v]): [string, string][] =>
      v === undefined ? [] : [[k, v]],
    ),
  );
  return handleConsent(
    new Request(`${ORIGIN}/oauth/consent`, {
      method: 'POST',
      body: form,
      headers,
    }),
    resolver,
  );
}

describe('POST /oauth/consent', () => {
  it('sends an approval back to the redirect address with a code, the state and the issuer', async () => {
    const res = await consent();
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://app.example/cb',
    );
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
    expect(location.searchParams.get('code')).toMatch(/^cdn_/);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get()).toEqual({
      n: 1,
    });
  });

  it('sends a refusal back as access_denied and mints nothing', async () => {
    const res = await consent({ decision: 'deny' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get()).toEqual({
      n: 0,
    });
  });

  it('accepts a loopback redirect on a different port than the registered one', async () => {
    const res = await consent({
      redirect_uri: 'http://localhost:51234/oauth/callback',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain(
      'http://localhost:51234/oauth/callback?',
    );
  });

  it('reports a problem with the request to the verified redirect address', async () => {
    const res = await consent({ response_type: 'token' });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe(
      'unsupported_response_type',
    );
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(location.searchParams.get('iss')).toBe(ORIGIN);
  });

  it('shows an error, with no redirect, for a redirect address the client never registered', async () => {
    const res = await consent({ redirect_uri: 'https://evil.example/cb' });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('shows an error, with no redirect, for a stored address the rules no longer allow', async () => {
    const res = await consent({ redirect_uri: urls.exampleOld });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('shows an error for a client that is not known', async () => {
    const res = await consent({ client_id: 'dcr_nobody' });
    expect(res.status).toBe(400);
  });

  it('refuses a cross-site post', async () => {
    const res = await consent({}, { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
  });

  it('refuses a session the person has since ended everywhere, and mints nothing', async () => {
    session.ended = true;
    const res = await consent();
    expect(res.status).toBe(401);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get()).toEqual({
      n: 0,
    });
  });

  it('asks for sign-in when nobody is signed in', async () => {
    session.uid = null;
    const res = await consent();
    expect(res.status).toBe(401);
  });

  it('answers 400 for a body that is not readable text', async () => {
    const res = await handleConsent(
      new Request(`${ORIGIN}/oauth/consent`, {
        method: 'POST',

        body: new Uint8Array([0xff, 0xfe]),
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
      resolver,
    );
    expect(res.status).toBe(400);
  });

  it('answers 413 for a form over 16 KiB, without minting anything', async () => {
    const res = await consent({ state: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get()).toEqual({
      n: 0,
    });
  });

  describe('how much to allow', () => {
    const grantedScope = () =>
      raw.prepare('SELECT scope FROM oauth_codes').get()?.['scope'];

    it('grants everything the app asked for when the person chose no narrower access', async () => {
      await consent({ access: 'write' });
      expect(grantedScope()).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
    });

    it('grants everything when the form has no access field, as a form posted before the choice existed', async () => {
      await consent();
      expect(grantedScope()).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
    });

    it('grants read-only when the person chose it', async () => {
      const res = await consent({ access: 'read' });
      expect(res.status).toBe(303);
      expect(grantedScope()).toBe(SCOPE_READ);
    });

    it('grants read-only to an app that asked only to edit, never more than asked', async () => {
      await consent({ access: 'read', scope: SCOPE_WRITE });
      expect(grantedScope()).toBe(SCOPE_READ);
    });

    it('never widens: an access of write grants only what was asked', async () => {
      await consent({ access: 'write', scope: SCOPE_READ });
      expect(grantedScope()).toBe(SCOPE_READ);
    });

    it('logs that the grant was narrowed', async () => {
      const info = jest.spyOn(console, 'info').mockImplementation(() => {});
      await consent({ access: 'read' });
      expect(
        info.mock.calls.map(([line]) => JSON.parse(String(line))),
      ).toContainEqual(
        expect.objectContaining({
          event: 'oauth.scope_narrowed',
          clientId: 'dcr_abc',
          requested: `${SCOPE_READ} ${SCOPE_WRITE}`,
          granted: SCOPE_READ,
        }),
      );
      info.mockRestore();
    });
  });

  it('logs a refusal as a security event', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    await consent({ decision: 'deny' });
    expect(
      info.mock.calls.map(([line]) => JSON.parse(String(line))),
    ).toContainEqual(
      expect.objectContaining({
        event: 'oauth.consent_denied',
        clientId: 'dcr_abc',
        userId: 7,
      }),
    );
    info.mockRestore();
  });

  it('refuses to fetch a client document hosted on this very site', async () => {
    const fetched = jest.spyOn(globalThis, 'fetch');
    const res = await consent({
      client_id: `${ORIGIN}/.well-known/oauth-authorization-server`,
      redirect_uri: `${ORIGIN}/cb`,
    });
    expect(res.status).toBe(400);
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });

  it('counts a document fetch against the asking address before the shared allowance', async () => {
    raw
      .prepare(
        'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)',
      )
      .run(
        'oauth-cimd-address:203.0.113.7',
        Math.floor(Date.now() / 1000),
        10_000,
      );
    const res = await consent(
      {
        client_id: 'https://claude.ai/oauth/metadata.json',
        redirect_uri: 'https://claude.ai/cb',
      },
      { 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.7' },
    );
    expect(res.status).toBe(429);
    expect(
      raw
        .prepare(
          "SELECT count FROM rate_limits WHERE key = 'oauth-cimd-all:all'",
        )
        .get(),
    ).toBeUndefined();
  });

  it('answers 429 with Retry-After when too many client documents are being fetched', async () => {
    raw
      .prepare(
        'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)',
      )
      .run('oauth-cimd-all:all', Math.floor(Date.now() / 1000), 10_000);
    const res = await consent({
      client_id: 'https://claude.ai/oauth/metadata.json',
      redirect_uri: 'https://claude.ai/cb',
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
