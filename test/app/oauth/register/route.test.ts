import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { OPTIONS, POST } from '@/app/oauth/register/route';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import insecure from '../../../fixtures/insecure-urls.json';

let restore: () => void;

beforeEach(() => {
  restore = installCloudflareContext(sqliteD1(...APP_MIGRATIONS).d1);
});

afterEach(() => restore());

const register = (body: string) =>
  POST(
    new Request('https://app.test/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
  );

describe('POST /oauth/register', () => {
  it('registers a client with 201', async () => {
    const response = await register(
      JSON.stringify({ redirect_uris: ['https://claude.ai/cb'] }),
    );
    expect(response.status).toBe(201);
  });

  it('refuses a body that is not JSON', async () => {
    const reply = await register('{');
    expect(await reply.json()).toMatchObject({
      error: 'invalid_client_metadata',
    });
  });

  it('refuses an unsafe redirect URI', async () => {
    const response = await register(
      JSON.stringify({ redirect_uris: [insecure.httpEvilCallback] }),
    );
    expect(await response.json()).toMatchObject({
      error: 'invalid_redirect_uri',
    });
  });

  it('answers the preflight', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
