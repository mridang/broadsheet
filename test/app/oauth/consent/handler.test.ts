import { beforeEach, describe, expect, it } from '@jest/globals';

import { handleConsent } from '@/app/oauth/consent/handler';
import type { CurrentUserResolver } from '@/domain/api/auth';
import { databaseFrom } from '@/domain/db/database';
import { D1OAuthStore } from '@/domain/db/oauth';
import { hashSecret } from '@/lib/oauth';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import { sqliteD1 } from '../../../lib/core/db/sqlite-d1';

const ORIGIN = 'https://app.test';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

let store: D1OAuthStore;

beforeEach(async () => {
  store = new D1OAuthStore(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
  await store.saveClient({
    clientId: 'c1',
    name: 'Claude',
    redirectUris: ['https://claude.ai/cb'],
  });
});

/** A resolver that says the browser belongs to `uid` (or nobody). */
const as = (uid: number | null): CurrentUserResolver => ({
  currentUid: async () => uid,
  currentLiveUid: async () => uid,
  currentUser: async () => null,
});

const FIELDS = {
  response_type: 'code',
  client_id: 'c1',
  redirect_uri: 'https://claude.ai/cb',
  state: 's',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
};

const post = (fields: Record<string, string>, site = 'same-origin'): Request =>
  new Request(`${ORIGIN}/oauth/consent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Sec-Fetch-Site': site,
    },
    body: new URLSearchParams(fields).toString(),
  });

const decide = (request: Request, uid: number | null = 1) =>
  handleConsent(request, as(uid), () => store);

describe('handleConsent', () => {
  it('sends an approval back with a code the store can redeem', async () => {
    const response = await decide(post({ ...FIELDS, decision: 'approve' }));
    const location = new URL(response.headers.get('location')!);
    const redeemed = await store.takeCode(
      await hashSecret(location.searchParams.get('code')!),
    );
    expect([
      response.status,
      location.origin,
      location.searchParams.get('state'),
      location.searchParams.get('iss'),
      redeemed?.userId,
    ]).toEqual([303, 'https://claude.ai', 's', ORIGIN, 1]);
  });

  it('sends a cancel back as access_denied', async () => {
    const response = await decide(post({ ...FIELDS, decision: 'cancel' }));
    expect(response.headers.get('location')).toBe(
      'https://claude.ai/cb?error=access_denied&state=s&iss=https%3A%2F%2Fapp.test',
    );
  });

  it('refuses a cross-site post', async () => {
    const response = await decide(post(FIELDS, 'cross-site'));
    expect(response.status).toBe(403);
  });

  it('refuses a browser that is not signed in', async () => {
    const response = await decide(post(FIELDS), null);
    expect(response.status).toBe(401);
  });

  it('refuses an unknown client without redirecting', async () => {
    const response = await decide(post({ ...FIELDS, client_id: 'nope' }));
    expect([response.status, response.headers.get('location')]).toEqual([
      400,
      null,
    ]);
  });

  it('reports a later problem to the verified redirect URI', async () => {
    const response = await decide(
      post({ ...FIELDS, code_challenge_method: 'plain', decision: 'approve' }),
    );
    expect(response.headers.get('location')).toContain('error=invalid_request');
  });

  it('refuses a form that is too large', async () => {
    const response = await decide(post({ x: 'a'.repeat(20_000) }));
    expect(response.status).toBe(413);
  });
});
