import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { OPTIONS, POST } from '@/app/oauth/token/route';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';

let restore: () => void;

beforeEach(() => {
  restore = installCloudflareContext(sqliteD1(...APP_MIGRATIONS).d1);
});

afterEach(() => restore());

const token = (body: string, type = 'application/x-www-form-urlencoded') =>
  POST(
    new Request('https://app.test/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    }),
  );

describe('POST /oauth/token', () => {
  it('refuses an unknown code', async () => {
    const response = await token(
      'grant_type=authorization_code&client_id=c1&code=x&code_verifier=y',
    );
    expect([
      response.status,
      ((await response.json()) as { error: string }).error,
    ]).toEqual([400, 'invalid_grant']);
  });

  it('refuses a JSON body', async () => {
    const response = await token('{}', 'application/json');
    expect(((await response.json()) as { error: string }).error).toBe(
      'invalid_request',
    );
  });

  it('never lets an answer be stored', async () => {
    const response = await token('client_id=c1');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers the preflight', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
