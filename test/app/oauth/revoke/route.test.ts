import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { OPTIONS, POST } from '@/app/oauth/revoke/route';
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

const revoke = (body: string, type = 'application/x-www-form-urlencoded') =>
  POST(
    new Request('https://app.test/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    }),
  );

describe('POST /oauth/revoke', () => {
  it('answers 200 for an unknown token', async () => {
    expect((await revoke('token=nope')).status).toBe(200);
  });

  it('needs a token', async () => {
    expect((await revoke('')).status).toBe(400);
  });

  it('refuses a JSON body', async () => {
    expect((await revoke('{}', 'application/json')).status).toBe(400);
  });

  it('answers the preflight', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
